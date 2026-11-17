/**
 * Token counting and savings telemetry.
 *
 * Token counting uses `tiktoken` so the "tokens saved" figure reflects real LLM
 * tokenization rather than a character-count approximation. The cumulative
 * session totals are persisted to a JSON stats file so the (separate) MCP
 * server process and the extension host can share state: the server writes,
 * the extension watches and renders the status bar.
 */

import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { get_encoding, type Tiktoken } from 'tiktoken';
import { emptyRedactionCounts, type RedactionCounts } from './redactor.js';

/** Encoding used for token estimation (GPT-4o / o-series family). */
const ENCODING = 'o200k_base';

/** Lazily-initialized shared encoder; created on first use, freed by callers. */
let encoder: Tiktoken | undefined;

function getEncoder(): Tiktoken {
  if (!encoder) {
    encoder = get_encoding(ENCODING);
  }
  return encoder;
}

/**
 * Counts the number of tokens in `text` using the configured encoding.
 *
 * @param text The text to tokenize.
 * @returns The token count.
 */
export function countTokens(text: string): number {
  if (text.length === 0) {
    return 0;
  }
  return getEncoder().encode(text).length;
}

/** A single optimization measurement (one tool call). */
export interface SavingsRecord {
  /** Tokens in the raw payload. */
  readonly rawTokens: number;
  /** Tokens in the optimized payload. */
  readonly optimizedTokens: number;
  /** Tokens saved (raw - optimized, never negative). */
  readonly savedTokens: number;
  /** Saved fraction as a percentage (0-100). */
  readonly savedPct: number;
}

/**
 * Computes a {@link SavingsRecord} for a raw/optimized payload pair.
 *
 * @param rawText       The original payload.
 * @param optimizedText The optimized payload.
 * @returns The token savings for this pair.
 */
export function measureSavings(rawText: string, optimizedText: string): SavingsRecord {
  const rawTokens = countTokens(rawText);
  const optimizedTokens = countTokens(optimizedText);
  const savedTokens = Math.max(0, rawTokens - optimizedTokens);
  const savedPct = rawTokens === 0 ? 0 : (savedTokens / rawTokens) * 100;
  return { rawTokens, optimizedTokens, savedTokens, savedPct };
}

/** Cumulative, session-wide totals persisted to the stats file. */
export interface SessionStats {
  /** Number of optimization calls recorded. */
  calls: number;
  /** Sum of raw tokens across all calls. */
  totalRawTokens: number;
  /** Sum of optimized tokens across all calls. */
  totalOptimizedTokens: number;
  /** Sum of saved tokens across all calls. */
  totalSavedTokens: number;
  /** Estimated GitHub AI Credits saved, using the configured input token price. */
  totalEstimatedSavedAICredits: number;
  /** Sensitive values masked across all calls, per category. */
  redactions: RedactionCounts;
}

/** Returns an empty {@link SessionStats} accumulator. */
export function emptyStats(): SessionStats {
  return {
    calls: 0,
    totalRawTokens: 0,
    totalOptimizedTokens: 0,
    totalSavedTokens: 0,
    totalEstimatedSavedAICredits: 0,
    redactions: emptyRedactionCounts()
  };
}

/** Converts saved input tokens to AI Credits at 100 credits per USD. */
export function estimateSavedAICredits(
  savedTokens: number,
  inputPricePerMillionUsd: number
): number {
  return (savedTokens * inputPricePerMillionUsd) / 10_000;
}

/**
 * Reads cumulative stats from `filePath`. Returns empty stats when the file is
 * missing or unreadable so first-run and transient errors degrade gracefully.
 *
 * @param filePath Absolute path to the stats JSON file.
 */
export async function readStats(
  filePath: string,
  inputPricePerMillionUsd = 1
): Promise<SessionStats> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<SessionStats>;
    const totalSavedTokens = parsed.totalSavedTokens ?? 0;
    return {
      calls: parsed.calls ?? 0,
      totalRawTokens: parsed.totalRawTokens ?? 0,
      totalOptimizedTokens: parsed.totalOptimizedTokens ?? 0,
      totalSavedTokens,
      totalEstimatedSavedAICredits:
        parsed.totalEstimatedSavedAICredits ??
        estimateSavedAICredits(totalSavedTokens, inputPricePerMillionUsd),
      redactions: { ...emptyRedactionCounts(), ...parsed.redactions }
    };
  } catch {
    return emptyStats();
  }
}

/**
 * Folds a single {@link SavingsRecord} into the persisted cumulative stats and
 * writes the result back to `filePath` atomically (write-temp-then-rename) so a
 * watching reader never observes a half-written file.
 *
 * @param filePath Absolute path to the stats JSON file.
 * @param record   The savings to add.
 * @param redactions Sensitive values masked in this call.
 * @returns The updated cumulative stats.
 */
export async function recordSavings(
  filePath: string,
  record: SavingsRecord,
  redactions: RedactionCounts = emptyRedactionCounts(),
  inputPricePerMillionUsd = 1
): Promise<SessionStats> {
  return withFileLock(filePath, async () => {
    const current = await readStats(filePath, inputPricePerMillionUsd);
    const r = current.redactions;
    const updated: SessionStats = {
      calls: current.calls + 1,
      totalRawTokens: current.totalRawTokens + record.rawTokens,
      totalOptimizedTokens: current.totalOptimizedTokens + record.optimizedTokens,
      totalSavedTokens: current.totalSavedTokens + record.savedTokens,
      totalEstimatedSavedAICredits:
        current.totalEstimatedSavedAICredits +
        estimateSavedAICredits(record.savedTokens, inputPricePerMillionUsd),
      redactions: {
        secrets: r.secrets + redactions.secrets,
        ipv4: r.ipv4 + redactions.ipv4,
        ipv6: r.ipv6 + redactions.ipv6,
        mac: r.mac + redactions.mac,
        email: r.email + redactions.email
      }
    };

    const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(updated, null, 2), 'utf8');
    await fs.rename(tempPath, filePath);
    return updated;
  });
}

const LOCK_RETRY_MS = 20;
const LOCK_TIMEOUT_MS = 5_000;
const LOCK_STALE_MS = 10_000;

/**
 * Serializes read-modify-write of the stats file across processes. Every VS
 * Code window runs its own MCP server against the same global file, so without
 * this lock concurrent updates would overwrite each other and lose savings.
 */
async function withFileLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  const lockPath = `${filePath}.lock`;
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  for (;;) {
    try {
      await fs.mkdir(lockPath);
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw err;
      }
      const stat = await fs.stat(lockPath).catch(() => undefined);
      if (stat && Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
        await fs.rm(lockPath, { recursive: true, force: true });
        continue;
      }
      if (Date.now() > deadline) {
        throw new Error(`Timed out acquiring stats lock: ${lockPath}`);
      }
      await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS));
    }
  }
  try {
    return await fn();
  } finally {
    await fs.rm(lockPath, { recursive: true, force: true });
  }
}

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
import { withFileLock } from './file-lock.js';
import {
  addRedactionCounts,
  emptyRedactionCounts,
  type RedactionCounts
} from './redactor.js';

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
  /** Net tokens saved (raw - optimized; negative when output is larger). */
  readonly savedTokens: number;
  /** Net saved fraction as a percentage; negative when output is larger. */
  readonly savedPct: number;
  /** Tokens in the complete textual tool reply, including its summary line. */
  readonly responseTokens?: number;
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
  const savedTokens = rawTokens - optimizedTokens;
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
  /** Calls with complete textual tool-reply measurements. */
  responseCalls: number;
  /** Input tokens for calls with complete textual tool-reply measurements. */
  totalResponseInputTokens: number;
  /** Returned text tokens, including the tool summary line. */
  totalResponseTokens: number;
  /** Net tokens saved after accounting for the complete textual tool reply. */
  totalNetSavedTokens: number;
  /** Estimated credits saved after accounting for the complete textual tool reply. */
  totalEstimatedNetSavedAICredits: number;
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
    responseCalls: 0,
    totalResponseInputTokens: 0,
    totalResponseTokens: 0,
    totalNetSavedTokens: 0,
    totalEstimatedNetSavedAICredits: 0,
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
      responseCalls: parsed.responseCalls ?? 0,
      totalResponseInputTokens: parsed.totalResponseInputTokens ?? 0,
      totalResponseTokens: parsed.totalResponseTokens ?? 0,
      totalNetSavedTokens: parsed.totalNetSavedTokens ?? 0,
      totalEstimatedNetSavedAICredits:
        parsed.totalEstimatedNetSavedAICredits ?? 0,
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
    const hasReply = record.responseTokens !== undefined;
    const replyTokens = record.responseTokens ?? 0;
    const netSavedTokens = hasReply ? record.rawTokens - replyTokens : 0;
    const updated: SessionStats = {
      calls: current.calls + 1,
      totalRawTokens: current.totalRawTokens + record.rawTokens,
      totalOptimizedTokens: current.totalOptimizedTokens + record.optimizedTokens,
      totalSavedTokens: current.totalSavedTokens + record.savedTokens,
      totalEstimatedSavedAICredits:
        current.totalEstimatedSavedAICredits +
        estimateSavedAICredits(record.savedTokens, inputPricePerMillionUsd),
      responseCalls: current.responseCalls + (hasReply ? 1 : 0),
      totalResponseInputTokens:
        current.totalResponseInputTokens + (hasReply ? record.rawTokens : 0),
      totalResponseTokens: current.totalResponseTokens + replyTokens,
      totalNetSavedTokens: current.totalNetSavedTokens + netSavedTokens,
      totalEstimatedNetSavedAICredits:
        current.totalEstimatedNetSavedAICredits +
        estimateSavedAICredits(netSavedTokens, inputPricePerMillionUsd),
      redactions: addRedactionCounts(current.redactions, redactions)
    };

    const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(updated, null, 2), 'utf8');
    await fs.rename(tempPath, filePath);
    return updated;
  });
}

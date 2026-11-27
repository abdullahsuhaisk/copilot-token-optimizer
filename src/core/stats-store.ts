/**
 * Cumulative savings statistics, shared through a JSON file.
 *
 * Every VS Code window runs its own MCP server (the writer) and its own
 * extension (the reader, which watches the file), all against the same global
 * stats file. Writes go through a cross-process lock and an atomic rename, so a
 * watching reader never observes a half-written file.
 *
 * This module must not import `tokens.ts` at runtime: the extension host loads
 * it, and `tokens.ts` pulls in the tiktoken WASM module.
 */

import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { DEFAULT_INPUT_PRICE_PER_MILLION_USD, estimateSavedAICredits } from './credits.js';
import { withFileLock } from './file-lock.js';
import { addRedactionCounts, emptyRedactionCounts, type RedactionCounts } from './redactor.js';
import type { SavingsRecord } from './tokens.js';

/**
 * Totals across every call, window and workspace, persisted to the stats file.
 * (They are cumulative, not per session: the file outlives VS Code sessions.)
 */
export interface CumulativeStats {
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
  /** Returned text tokens, including any summary line. */
  totalResponseTokens: number;
  /** Net tokens saved after accounting for the complete textual tool reply. */
  totalNetSavedTokens: number;
  /** Estimated credits saved after accounting for the complete textual tool reply. */
  totalEstimatedNetSavedAICredits: number;
  /** Sensitive values masked across all calls, per category. */
  redactions: RedactionCounts;
}

/** Returns an empty {@link CumulativeStats} accumulator. */
export function emptyStats(): CumulativeStats {
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

/**
 * Reads cumulative stats from `filePath`. Returns empty stats when the file is
 * missing or unreadable so first-run and transient errors degrade gracefully.
 *
 * @param filePath                Absolute path to the stats JSON file.
 * @param inputPricePerMillionUsd Used to estimate credits for files written before credits were tracked.
 */
export async function readStats(
  filePath: string,
  inputPricePerMillionUsd = DEFAULT_INPUT_PRICE_PER_MILLION_USD
): Promise<CumulativeStats> {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, 'utf8')) as Partial<CumulativeStats>;
    const stats = emptyStats();

    // Copy only known numeric fields, so old, partial or hand-edited files still load.
    for (const [key, value] of Object.entries(parsed)) {
      if (key !== 'redactions' && Object.hasOwn(stats, key) && typeof value === 'number') {
        Object.assign(stats, { [key]: value });
      }
    }
    if (typeof parsed.totalEstimatedSavedAICredits !== 'number') {
      stats.totalEstimatedSavedAICredits = estimateSavedAICredits(
        stats.totalSavedTokens,
        inputPricePerMillionUsd
      );
    }
    stats.redactions = { ...stats.redactions, ...parsed.redactions };
    return stats;
  } catch {
    return emptyStats();
  }
}

/**
 * Folds a single {@link SavingsRecord} into the persisted cumulative stats and
 * writes the result back to `filePath` atomically (write-temp-then-rename).
 *
 * @param filePath   Absolute path to the stats JSON file.
 * @param record     The savings to add.
 * @param redactions Sensitive values masked in this call.
 * @returns The updated cumulative stats.
 */
export async function recordSavings(
  filePath: string,
  record: SavingsRecord,
  redactions: RedactionCounts = emptyRedactionCounts(),
  inputPricePerMillionUsd = DEFAULT_INPUT_PRICE_PER_MILLION_USD
): Promise<CumulativeStats> {
  return withFileLock(filePath, async () => {
    const current = await readStats(filePath, inputPricePerMillionUsd);
    const updated = addRecord(current, record, redactions, inputPricePerMillionUsd);

    const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(updated, null, 2), 'utf8');
    await fs.rename(tempPath, filePath);
    return updated;
  });
}

function addRecord(
  current: CumulativeStats,
  record: SavingsRecord,
  redactions: RedactionCounts,
  inputPricePerMillionUsd: number
): CumulativeStats {
  const hasReply = record.responseTokens !== undefined;
  const replyTokens = record.responseTokens ?? 0;
  const netSavedTokens = hasReply ? record.rawTokens - replyTokens : 0;

  return {
    calls: current.calls + 1,
    totalRawTokens: current.totalRawTokens + record.rawTokens,
    totalOptimizedTokens: current.totalOptimizedTokens + record.optimizedTokens,
    totalSavedTokens: current.totalSavedTokens + record.savedTokens,
    totalEstimatedSavedAICredits:
      current.totalEstimatedSavedAICredits +
      estimateSavedAICredits(record.savedTokens, inputPricePerMillionUsd),
    responseCalls: current.responseCalls + (hasReply ? 1 : 0),
    totalResponseInputTokens: current.totalResponseInputTokens + (hasReply ? record.rawTokens : 0),
    totalResponseTokens: current.totalResponseTokens + replyTokens,
    totalNetSavedTokens: current.totalNetSavedTokens + netSavedTokens,
    totalEstimatedNetSavedAICredits:
      current.totalEstimatedNetSavedAICredits +
      estimateSavedAICredits(netSavedTokens, inputPricePerMillionUsd),
    redactions: addRedactionCounts(current.redactions, redactions)
  };
}

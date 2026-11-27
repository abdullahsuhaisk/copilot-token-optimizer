/** Text the MCP server puts in its tool replies. */

import type { RedactionCounts } from '../redactor.js';
import type { CumulativeStats } from '../stats-store.js';
import type { SavingsRecord } from '../tokens.js';
import {
  formatCreditChange,
  formatRedactedValues,
  formatRedactionSummary,
  formatTokenChange,
  savedPercentage
} from './numbers.js';

/**
 * The one-line summary put in front of an optimized tool reply.
 *
 * It is short on purpose: the line itself costs tokens, so a long one would eat
 * the savings it reports.
 */
export function formatToolSummary(savings: SavingsRecord, redactions: RedactionCounts): string {
  const change =
    savings.savedTokens >= 0
      ? `saved ${savings.savedTokens}`
      : `added ${Math.abs(savings.savedTokens)}`;
  const summary =
    `[token-optimizer] ${savings.rawTokens}->${savings.optimizedTokens} tokens ` +
    `(${change}, ${savings.savedPct.toFixed(1)}%)`;
  const masked = formatRedactedValues(redactions);
  return masked ? `${summary} | ${masked}` : summary;
}

/** The cumulative statistics returned by the `get_token_stats` tool. */
export function formatToolStatsReport(
  stats: CumulativeStats,
  inputPricePerMillionUsd: number
): string {
  return [
    `Calls: ${stats.calls}`,
    `Payload raw tokens: ${stats.totalRawTokens}`,
    `Optimized payload tokens: ${stats.totalOptimizedTokens}`,
    `Payload net token change: ${formatTokenChange(stats.totalSavedTokens)} (${savedPercentage(stats).toFixed(1)}%)`,
    `Payload AI credit change (est.): ${formatCreditChange(stats.totalEstimatedSavedAICredits)}`,
    `Complete reply measurements: ${stats.responseCalls} calls`,
    `Measured input tokens: ${stats.totalResponseInputTokens}`,
    `Returned text tokens (including summary): ${stats.totalResponseTokens}`,
    `Net tokens after summary: ${formatTokenChange(stats.totalNetSavedTokens)}`,
    `Net AI credit change (est.): ${formatCreditChange(stats.totalEstimatedNetSavedAICredits)}`,
    `Current estimate rate: $${inputPricePerMillionUsd} per 1M input tokens`,
    'Estimate only; actual Copilot usage depends on model pricing and cached tokens.',
    formatRedactionSummary(stats.redactions)
  ].join('\n');
}

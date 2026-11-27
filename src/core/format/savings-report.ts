/** The detailed savings report the extension prints in its output channel. */

import { totalRedactions } from '../redactor.js';
import type { CumulativeStats } from '../stats-store.js';
import { formatAICreditChange, formatNetTokens, savedPercentage } from './numbers.js';

export function formatSavingsReport(
  stats: CumulativeStats,
  inputPricePerMillionUsd: number
): string[] {
  const row = (label: string, value: string | number) => `${label.padEnd(19)}: ${value}`;
  const redactions = stats.redactions;
  return [
    '=== AI Token Optimizer — Cumulative Savings ===',
    row('Optimization calls', stats.calls),
    row('Payload raw tokens', stats.totalRawTokens),
    row('Optimized payload', stats.totalOptimizedTokens),
    row(
      'Payload net change',
      `${formatNetTokens(stats.totalSavedTokens)} (${savedPercentage(stats).toFixed(1)}%)`
    ),
    row('Payload credits', `${formatAICreditChange(stats.totalEstimatedSavedAICredits)} (estimated)`),
    row('Complete replies', stats.responseCalls),
    row('Measured input', `${stats.totalResponseInputTokens} tokens`),
    row('Returned text', `${stats.totalResponseTokens} tokens (summary included)`),
    row('Net reply change', formatNetTokens(stats.totalNetSavedTokens)),
    row(
      'Net reply credits',
      `${formatAICreditChange(stats.totalEstimatedNetSavedAICredits)} (estimated)`
    ),
    row('Estimate rate', `$${inputPricePerMillionUsd} per 1M input tokens`),
    'Estimate only; actual Copilot usage depends on model pricing and cached tokens.',
    row('Redacted (total)', totalRedactions(redactions)),
    row('  Secrets / keys', redactions.secrets),
    row('  IPv4 addresses', redactions.ipv4),
    row('  IPv6 addresses', redactions.ipv6),
    row('  MAC addresses', redactions.mac),
    row('  E-mail addresses', redactions.email)
  ];
}

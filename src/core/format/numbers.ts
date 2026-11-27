/**
 * Number and phrase helpers shared by every text the project shows: the status
 * bar, the savings report and the MCP tool replies.
 */

import { totalRedactions, type RedactionCounts } from '../redactor.js';
import type { CumulativeStats } from '../stats-store.js';

/** e.g. "25 saved" or "10 added". */
export function formatTokenChange(tokens: number): string {
  return tokens >= 0 ? `${tokens} saved` : `${Math.abs(tokens)} added`;
}

/** e.g. "25 saved tokens" or "10 added tokens". */
export function formatNetTokens(tokens: number): string {
  return `${formatTokenChange(tokens)} tokens`;
}

/** Rounds to 6 decimals and drops trailing zeros. */
function formatAICredits(credits: number): string {
  return String(Number(credits.toFixed(6)));
}

function formatCredits(credits: number, savedSuffix: string, addedSuffix: string): string {
  return credits >= 0
    ? `~${formatAICredits(credits)} ${savedSuffix}`
    : `~${formatAICredits(Math.abs(credits))} ${addedSuffix}`;
}

/** e.g. "~0.0025 AI credits" or "~0.001 AI credits added". */
export function formatAICreditChange(credits: number): string {
  return formatCredits(credits, 'AI credits', 'AI credits added');
}

/** e.g. "~0.0025 saved" or "~0.001 added". */
export function formatCreditChange(credits: number): string {
  return formatCredits(credits, 'saved', 'added');
}

/** Display label for each redaction category, in reporting order. */
const REDACTION_LABELS: ReadonlyArray<readonly [keyof RedactionCounts, string]> = [
  ['secrets', 'secrets'],
  ['ipv4', 'IPv4'],
  ['ipv6', 'IPv6'],
  ['mac', 'MAC'],
  ['email', 'e-mail']
];

/** e.g. "Redacted: 3 (secrets 1, IPv4 2, IPv6 0, MAC 0, e-mail 0)". */
export function formatRedactionSummary(counts: RedactionCounts): string {
  const parts = REDACTION_LABELS.map(([key, label]) => `${label} ${counts[key]}`);
  return `Redacted: ${totalRedactions(counts)} (${parts.join(', ')})`;
}

/** e.g. "redacted 3: secrets 1, IPv4 2"; empty when nothing was masked. */
export function formatRedactedValues(counts: RedactionCounts): string {
  const total = totalRedactions(counts);
  if (total === 0) {
    return '';
  }
  const parts = REDACTION_LABELS.filter(([key]) => counts[key] > 0).map(
    ([key, label]) => `${label} ${counts[key]}`
  );
  return `redacted ${total}: ${parts.join(', ')}`;
}

export function savedPercentage(stats: CumulativeStats): number {
  return stats.totalRawTokens === 0
    ? 0
    : (stats.totalSavedTokens / stats.totalRawTokens) * 100;
}

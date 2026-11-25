/**
 * User-facing text for the status bar, the savings report and MCP tool
 * replies. Kept free of `vscode` so both entry points share one formatter.
 */

import { estimateSavedAICredits, type SavingsRecord, type SessionStats } from './telemetry.js';
import { totalRedactions, type RedactionCounts } from './redactor.js';

// ---------------------------------------------------------------------------
// VS Code extension: status bar and output channel report
// ---------------------------------------------------------------------------

export function formatStatusBarText(stats: SessionStats): string {
  const payload = stats.calls > stats.responseCalls
    ? `Payload ${formatNetTokens(stats.totalSavedTokens)} · ` +
      `${formatAICreditChange(stats.totalEstimatedSavedAICredits)} · `
    : '';
  const reply = stats.responseCalls === 0
    ? 'Reply not measured'
    : `Reply ${formatNetTokens(stats.totalNetSavedTokens)} · ` +
      `${formatAICreditChange(stats.totalEstimatedNetSavedAICredits)}`;
  return `$(zap) ${payload}${reply} · $(shield) ${totalRedactions(stats.redactions)} redacted`;
}

export function formatSavingsReport(stats: SessionStats, inputPricePerMillionUsd: number): string[] {
  const row = (label: string, value: string | number) => `${label.padEnd(19)}: ${value}`;
  const redactions = stats.redactions;
  return [
    '=== AI Token Optimizer — Session Savings ===',
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

/** e.g. "25 saved tokens" or "10 added tokens". */
function formatNetTokens(tokens: number): string {
  return `${formatTokenChange(tokens)} tokens`;
}

/** e.g. "~0.0025 AI credits" or "~0.001 AI credits added". */
function formatAICreditChange(credits: number): string {
  return credits >= 0
    ? `~${formatAICredits(credits)} AI credits`
    : `~${formatAICredits(Math.abs(credits))} AI credits added`;
}

// ---------------------------------------------------------------------------
// MCP server: per-call summary line and `get_token_stats` report
// ---------------------------------------------------------------------------

/** The one-line summary prepended to every optimized tool reply. */
export function formatToolSummary(
  savings: SavingsRecord,
  redactions: RedactionCounts,
  inputPricePerMillionUsd: number
): string {
  const pct = savings.savedPct.toFixed(1);
  const tokenChange = savings.savedTokens >= 0
    ? `saved ${savings.savedTokens}, ${pct}%`
    : `added ${Math.abs(savings.savedTokens)}, ${pct}%`;
  const credits = estimateSavedAICredits(savings.savedTokens, inputPricePerMillionUsd);
  return (
    `Payload tokens: ${savings.rawTokens} -> ${savings.optimizedTokens} (${tokenChange})` +
    ` | Payload AI credit change (est.): ${formatCreditChange(credits)}` +
    ` ($${inputPricePerMillionUsd}/1M input tokens)` +
    ` | ${formatRedactionSummary(redactions)}`
  );
}

export function formatToolStatsReport(stats: SessionStats, inputPricePerMillionUsd: number): string {
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

/** e.g. "~0.0025 saved" or "~0.001 added". */
function formatCreditChange(credits: number): string {
  return credits >= 0
    ? `~${formatAICredits(credits)} saved`
    : `~${formatAICredits(Math.abs(credits))} added`;
}

/** e.g. "Redacted: 3 (secrets 1, IPv4 2, IPv6 0, MAC 0, e-mail 0)". */
function formatRedactionSummary(counts: RedactionCounts): string {
  return (
    `Redacted: ${totalRedactions(counts)} (secrets ${counts.secrets}, IPv4 ${counts.ipv4}, ` +
    `IPv6 ${counts.ipv6}, MAC ${counts.mac}, e-mail ${counts.email})`
  );
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function savedPercentage(stats: SessionStats): number {
  return stats.totalRawTokens === 0
    ? 0
    : (stats.totalSavedTokens / stats.totalRawTokens) * 100;
}

/** e.g. "25 saved" or "10 added". */
function formatTokenChange(tokens: number): string {
  return tokens >= 0 ? `${tokens} saved` : `${Math.abs(tokens)} added`;
}

/** Rounds to 6 decimals and drops trailing zeros. */
function formatAICredits(credits: number): string {
  return String(Number(credits.toFixed(6)));
}

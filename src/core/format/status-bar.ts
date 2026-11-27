/** The extension's status bar text. */

import { totalRedactions } from '../redactor.js';
import type { CumulativeStats } from '../stats-store.js';
import { formatAICreditChange, formatNetTokens } from './numbers.js';

export function formatStatusBarText(stats: CumulativeStats): string {
  // Calls recorded before replies were measured keep their payload-only totals.
  const payload =
    stats.calls > stats.responseCalls
      ? `Payload ${formatNetTokens(stats.totalSavedTokens)} · ` +
        `${formatAICreditChange(stats.totalEstimatedSavedAICredits)} · `
      : '';
  const reply =
    stats.responseCalls === 0
      ? 'Reply not measured'
      : `Reply ${formatNetTokens(stats.totalNetSavedTokens)} · ` +
        `${formatAICreditChange(stats.totalEstimatedNetSavedAICredits)}`;
  return `$(zap) ${payload}${reply} · $(shield) ${totalRedactions(stats.redactions)} redacted`;
}

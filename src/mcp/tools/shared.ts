/** Helpers shared by the MCP tools. */

import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { formatToolSummary } from '../../core/format/tool-reply.js';
import { optimize, type OptimizeOptions } from '../../core/optimizer.js';
import type { RedactionCounts } from '../../core/redactor.js';
import { recordSavings } from '../../core/stats-store.js';
import { countTokens, measureSavings, type SavingsRecord } from '../../core/tokens.js';
import type { ServerConfig } from '../config.js';
import { errorMessage, log } from '../diagnostics.js';

export const levelSchema = z
  .enum(['conservative', 'aggressive'])
  .optional()
  .describe(
    'Pruning level. Aggressive folds repeated spaces only when languageId is explicitly plaintext.'
  );

export function textResult(text: string): CallToolResult {
  return { content: [{ type: 'text', text }] };
}

export function errorResult(message: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

/**
 * Optimizes `rawText`, records the savings and returns the tool reply: the
 * optimized text, preceded by a one-line savings summary when anything changed.
 */
export async function optimizedReply(
  config: ServerConfig,
  rawText: string,
  options: OptimizeOptions
): Promise<CallToolResult> {
  const result = optimize(rawText, options);
  const savings = measureSavings(rawText, result.optimized);
  // A summary on an unchanged payload would only add tokens.
  const reply =
    result.optimized === rawText
      ? result.optimized
      : `${formatToolSummary(savings, result.redactions)}\n${result.optimized}`;

  // Never log payload text: even optimized output is only as safe as the redactor.
  log(`optimized ${savings.rawTokens} -> ${savings.optimizedTokens} tokens`);
  await recordStats(config, { ...savings, responseTokens: countTokens(reply) }, result.redactions);
  return textResult(reply);
}

/** Telemetry is best-effort: failures are logged but never break a tool call. */
async function recordStats(
  config: ServerConfig,
  record: SavingsRecord,
  redactions: RedactionCounts
): Promise<void> {
  if (!config.statsFile) {
    return;
  }
  try {
    await recordSavings(config.statsFile, record, redactions, config.inputPricePerMillionUsd);
  } catch (err) {
    log(`failed to record stats: ${errorMessage(err)}`);
  }
}

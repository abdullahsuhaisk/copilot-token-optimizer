/**
 * Token counting and savings measurement.
 *
 * Counting uses `tiktoken`, so "tokens saved" reflects real LLM tokenization
 * rather than a character-count approximation.
 *
 * Importing `tiktoken` loads a WASM module, so only the MCP server process
 * should import this file. The extension host never counts tokens; it reads
 * the numbers the server stored (see `stats-store.ts`).
 */

import { get_encoding, type Tiktoken } from 'tiktoken';

/** Encoding used for token estimation (GPT-4o / o-series family). */
const ENCODING = 'o200k_base';

/** Created on first use and kept for the lifetime of the process. */
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
  /** Tokens in the complete textual tool reply, including any summary line. */
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

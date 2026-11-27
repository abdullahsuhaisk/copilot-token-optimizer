/**
 * Estimated GitHub AI Credits for input tokens. 1 AI Credit = $0.01.
 *
 * The result is an estimate based on the uncached input-token price, not
 * Copilot billing data.
 */

/** Default model input price, in USD per 1 million tokens. */
export const DEFAULT_INPUT_PRICE_PER_MILLION_USD = 1;

/**
 * Converts input tokens to AI Credits at 100 credits per USD. Negative token
 * counts give negative credits (tokens that were added rather than saved).
 */
export function estimateSavedAICredits(
  savedTokens: number,
  inputPricePerMillionUsd: number
): number {
  return (savedTokens * inputPricePerMillionUsd) / 10_000;
}

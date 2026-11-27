import { describe, expect, it } from 'vitest';
import { estimateSavedAICredits } from '../src/core/credits';

describe('estimateSavedAICredits', () => {
  it('converts saved input tokens using the configured per-million-token price', () => {
    expect(estimateSavedAICredits(250_000, 1.2)).toBe(30);
  });

  it('returns zero when no tokens or no price are configured', () => {
    expect(estimateSavedAICredits(0, 1)).toBe(0);
    expect(estimateSavedAICredits(1_000_000, 0)).toBe(0);
  });

  it('represents the estimated cost when a reply adds tokens', () => {
    expect(estimateSavedAICredits(-250_000, 1.2)).toBe(-30);
  });
});

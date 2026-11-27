import { describe, expect, it } from 'vitest';
import { countTokens, measureSavings } from '../src/core/tokens';

describe('countTokens', () => {
  it('counts real tokens, not characters, and treats empty text as zero', () => {
    expect(countTokens('')).toBe(0);
    expect(countTokens('const x = 1;')).toBeGreaterThan(0);
    expect(countTokens('const x = 1;')).toBeLessThan('const x = 1;'.length);
  });
});

describe('measureSavings', () => {
  it('reports zero savings and no negative values for identical text', () => {
    const text = 'const x = 1;';
    const s = measureSavings(text, text);
    expect(s.savedTokens).toBe(0);
    expect(s.savedPct).toBe(0);
  });

  it('reports net token growth when the optimized text is larger', () => {
    const s = measureSavings('a', 'a much longer string than before');
    expect(s.savedTokens).toBeLessThan(0);
    expect(s.savedPct).toBeLessThan(0);
  });
});

import { describe, expect, it } from 'vitest';
import { formatToolSummary } from '../src/core/format/tool-reply';
import { emptyRedactionCounts } from '../src/core/redactor';
import { countTokens } from '../src/core/tokens';

describe('formatToolSummary', () => {
  const savings = { rawTokens: 175, optimizedTokens: 100, savedTokens: 75, savedPct: (75 / 175) * 100 };

  it('is one short line, so it does not eat the savings it reports', () => {
    const summary = formatToolSummary(savings, emptyRedactionCounts());

    expect(summary).toBe('[token-optimizer] 175->100 tokens (saved 75, 42.9%)');
    expect(summary).not.toContain('\n');
    expect(countTokens(summary)).toBeLessThan(25);
  });

  it('reports added tokens when the output is larger', () => {
    const summary = formatToolSummary(
      { rawTokens: 4, optimizedTokens: 5, savedTokens: -1, savedPct: -25 },
      emptyRedactionCounts()
    );
    expect(summary).toBe('[token-optimizer] 4->5 tokens (added 1, -25.0%)');
  });

  it('lists only the categories that were masked', () => {
    const summary = formatToolSummary(savings, { ...emptyRedactionCounts(), secrets: 1, email: 2 });
    expect(summary).toBe(
      '[token-optimizer] 175->100 tokens (saved 75, 42.9%) | redacted 3: secrets 1, e-mail 2'
    );
  });
});

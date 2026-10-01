import { describe, it, expect } from 'vitest';
import { optimize } from './optimizer';
import { measureSavings } from './telemetry';

describe('optimize - conservative (default)', () => {
  it('strips full-line C-style comments but keeps code', () => {
    const input = [
      '// header comment',
      'const x = 1;',
      '  // indented comment',
      'const y = 2;'
    ].join('\n');

    const { optimized } = optimize(input, { languageId: 'typescript' });

    expect(optimized).toBe(['const x = 1;', 'const y = 2;'].join('\n'));
  });

  it('strips block comments', () => {
    const input = 'const a = 1;\n/* multi\n   line\n   block */\nconst b = 2;';
    const { optimized } = optimize(input, { languageId: 'javascript' });

    expect(optimized).not.toContain('multi');
    expect(optimized).toContain('const a = 1;');
    expect(optimized).toContain('const b = 2;');
  });

  it('does NOT strip a marker that is inline after code (semantics preserved)', () => {
    const input = 'const url = "http://example.com"; // trailing note';
    const { optimized } = optimize(input, { languageId: 'typescript' });

    // The line is not a full-line comment, so the code (incl. the URL) stays.
    expect(optimized).toContain('const url = "http://example.com";');
  });

  it('collapses 2+ blank lines into one', () => {
    const input = 'a\n\n\n\nb';
    const { optimized } = optimize(input);
    expect(optimized).toBe('a\n\nb');
  });

  it('deduplicates consecutive identical log lines with a count', () => {
    const input = [
      'INFO request received',
      'INFO request received',
      'INFO request received',
      'INFO done'
    ].join('\n');

    const { optimized } = optimize(input);

    expect(optimized).toContain('INFO request received  (x3)');
    expect(optimized).toContain('INFO done');
    expect(optimized).not.toContain('INFO request received\nINFO request received');
  });

  it('trims trailing whitespace', () => {
    const input = 'const x = 1;   \nconst y = 2;\t\t';
    const { optimized } = optimize(input, { languageId: 'typescript' });
    expect(optimized).toBe('const x = 1;\nconst y = 2;');
  });

  it('leaves already-clean code unchanged (no semantic drift)', () => {
    const clean = ['function add(a, b) {', '  return a + b;', '}'].join('\n');
    const { optimized } = optimize(clean, { languageId: 'typescript' });
    expect(optimized).toBe(clean);
  });

  it('uses # comment syntax for python', () => {
    const input = ['# comment', 'x = 1', 'y = 2  # inline stays'].join('\n');
    const { optimized } = optimize(input, { languageId: 'python' });
    expect(optimized).toContain('x = 1');
    expect(optimized).toContain('y = 2  # inline stays');
    expect(optimized).not.toContain('# comment');
  });
});

describe('optimize - savings target band', () => {
  it('achieves a meaningful reduction on a verbose, comment-heavy payload', () => {
    const verbose = [
      '/**',
      ' * This is a long block comment that explains the function in great',
      ' * detail across multiple lines, none of which the model needs.',
      ' */',
      'function compute(values) {',
      '  // sum the values',
      '  let total = 0;',
      '',
      '',
      '',
      '  for (const v of values) {',
      '    total += v; // accumulate',
      '  }',
      '  return total;',
      '}',
      'DEBUG cache miss',
      'DEBUG cache miss',
      'DEBUG cache miss',
      'DEBUG cache miss'
    ].join('\n');

    const { optimized, rawChars, optimizedChars } = optimize(verbose, {
      languageId: 'javascript'
    });
    const savings = measureSavings(verbose, optimized);

    expect(optimizedChars).toBeLessThan(rawChars);
    // Token savings on this kind of noisy payload should comfortably exceed 20%.
    expect(savings.savedPct).toBeGreaterThanOrEqual(20);
  });
});

describe('measureSavings', () => {
  it('reports zero savings and no negative values for identical text', () => {
    const text = 'const x = 1;';
    const s = measureSavings(text, text);
    expect(s.savedTokens).toBe(0);
    expect(s.savedPct).toBe(0);
  });

  it('never reports negative savings when optimized is unexpectedly larger', () => {
    const s = measureSavings('a', 'a much longer string than before');
    expect(s.savedTokens).toBe(0);
    expect(s.savedPct).toBe(0);
  });
});

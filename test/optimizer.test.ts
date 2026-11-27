import { describe, it, expect } from 'vitest';
import { optimize } from '../src/core/optimizer';
import { languageIdFromPath } from '../src/core/languages';
import { measureSavings } from '../src/core/tokens';
import { PLACEHOLDER } from '../src/core/redactor';

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

    const { optimized } = optimize(input, { languageId: 'log' });

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

  it('preserves Markdown formatting in both optimization levels', () => {
    const markdown = '# Overview\n\nParagraph  \n\n---\n---';

    expect(optimize(markdown, { languageId: 'markdown' }).optimized).toBe(markdown);
    expect(
      optimize(markdown, { languageId: 'markdown', level: 'aggressive' }).optimized
    ).toBe(markdown);
  });

  it('preserves recognizable Markdown even when no languageId is supplied', () => {
    const markdown = '# Overview\n\nParagraph  \n\n---\n---';
    expect(optimize(markdown).optimized).toBe(markdown);
  });

  it('keeps code indentation and literal whitespace in aggressive mode', () => {
    const python = 'if ready:\n    execute()\n    label = "a   b"';
    expect(
      optimize(python, { languageId: 'python', level: 'aggressive' }).optimized
    ).toBe(python);
  });

  it('folds repeated spaces only in explicitly plain text aggressive mode', () => {
    const plainText = '  aligned    words';
    expect(
      optimize(plainText, { languageId: 'plaintext', level: 'aggressive' }).optimized
    ).toBe('  aligned words');
  });
});

describe('optimize - comment removal only touches whole-line comments', () => {
  it('keeps comment-like text inside string literals', () => {
    const input = 'const files = glob("src/**/*.ts");\nconst x = 1; /* keep me */\nrun(files);';
    expect(optimize(input, { languageId: 'typescript' }).optimized).toBe(input);
  });

  it('never deletes the code between a glob and a later comment', () => {
    const input = 'export default [{ files: ["**/*.ts"] }, { /* cfg */ rules: {} }];';
    expect(optimize(input, { languageId: 'javascript' }).optimized).toBe(input);
  });

  it('keeps comment delimiters that appear in a language table', () => {
    const source = "const C_LIKE = {\n  block: [['/*', '*/']]\n};";
    expect(optimize(source, { languageId: 'typescript' }).optimized).toBe(source);
  });

  it('removes block comments that occupy whole lines, including one-liners', () => {
    const input = [
      '/* license */',
      'const a = 1;',
      '  /**',
      '   * doc',
      '   */',
      'const b = 2;'
    ].join('\n');
    expect(optimize(input, { languageId: 'typescript' }).optimized).toBe(
      'const a = 1;\nconst b = 2;'
    );
  });

  it('keeps a block comment whose closing line continues with code', () => {
    const input = 'a();\n/* note\n   more */ b();\nc();';
    expect(optimize(input, { languageId: 'typescript' }).optimized).toBe(input);
  });

  it('keeps a block comment that is never closed', () => {
    const input = '/* never closed\nconst a = 1;';
    expect(optimize(input, { languageId: 'typescript' }).optimized).toBe(input);
  });
});

describe('optimize - repeated line folding', () => {
  it.each(['log', 'plaintext'])('folds repeated lines for %s', (languageId) => {
    const input = ['retry', 'retry', 'retry', 'done'].join('\n');
    expect(optimize(input, { languageId }).optimized).toBe('retry  (x3)\ndone');
  });

  it('never folds repeated lines in code or data', () => {
    const array = 'const a = [\n  0,\n  0,\n  0,\n];';
    expect(optimize(array, { languageId: 'typescript' }).optimized).toBe(array);
    expect(optimize(array).optimized).toBe(array);
  });
});

describe('optimize - pathological input', () => {
  it('trims a very long whitespace run in linear time', () => {
    const started = performance.now();
    optimize(' '.repeat(100_000) + 'x', { languageId: 'typescript' });
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it('handles a huge unterminated block comment without overflowing the stack', () => {
    const input = '/* open\n' + 'line\n'.repeat(300_000);
    expect(optimize(input, { languageId: 'typescript' }).optimized).toBe(input.trimEnd());
  });
});

describe('languageIdFromPath', () => {
  it('maps extensions case-insensitively and ignores unknown or missing ones', () => {
    expect(languageIdFromPath('src/App.TSX')).toBe('typescriptreact');
    expect(languageIdFromPath('build/output.log')).toBe('log');
    expect(languageIdFromPath('Makefile')).toBeUndefined();
    expect(languageIdFromPath('notes.constructor')).toBeUndefined();
    expect(languageIdFromPath('archive.d/readme')).toBeUndefined();
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

describe('optimize - redaction', () => {
  it('is applied by optimize() by default and can be disabled', () => {
    const input = 'const host = "192.168.1.10";';
    const on = optimize(input, { languageId: 'typescript' });
    expect(on.optimized).toBe(`const host = "${PLACEHOLDER.ipv4}";`);
    expect(on.redactions.ipv4).toBe(1);

    const off = optimize(input, { languageId: 'typescript', redact: false });
    expect(off.optimized).toBe(input);
    expect(off.redactions.ipv4).toBe(0);
  });
});

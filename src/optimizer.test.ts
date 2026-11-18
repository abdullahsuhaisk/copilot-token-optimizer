import { describe, it, expect } from 'vitest';
import { optimize } from './optimizer';
import { measureSavings } from './telemetry';
import { redactSensitive, PLACEHOLDER } from './redactor';

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

describe('redactSensitive', () => {
  it('masks IPv4 addresses but keeps loopback and invalid/version-like strings', () => {
    const { text, counts } = redactSensitive(
      'host=10.20.30.40 local=127.0.0.1 version=1.2.3 bad=999.1.1.1'
    );
    expect(text).toBe(`host=${PLACEHOLDER.ipv4} local=127.0.0.1 version=1.2.3 bad=999.1.1.1`);
    expect(counts.ipv4).toBe(1);
  });

  it('masks IPv6 addresses without touching `::` in code or clock times', () => {
    const { text, counts } = redactSensitive(
      'addr fe80::1ff:fe23:4567:890a and 2001:db8::1, std::string at 12:30:45'
    );
    expect(text).toBe(
      `addr ${PLACEHOLDER.ipv6} and ${PLACEHOLDER.ipv6}, std::string at 12:30:45`
    );
    expect(counts.ipv6).toBe(2);
  });

  it('masks MAC addresses in colon, dash and Cisco formats', () => {
    const { text, counts } = redactSensitive(
      '00:1A:2B:3C:4D:5E 00-1a-2b-3c-4d-5e 001a.2b3c.4d5e'
    );
    expect(text).toBe(`${PLACEHOLDER.mac} ${PLACEHOLDER.mac} ${PLACEHOLDER.mac}`);
    expect(counts.mac).toBe(3);
  });

  it('masks well-known token formats', () => {
    const input = [
      'AKIAIOSFODNN7EXAMPLE',
      'ghp_' + 'a'.repeat(36),
      'AIza' + 'B'.repeat(35),
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'
    ].join('\n');
    const { text, counts } = redactSensitive(input);
    expect(text.split('\n').every((l) => l === PLACEHOLDER.secret)).toBe(true);
    expect(counts.secrets).toBe(4);
  });

  it('keeps the key name and masks only the value in assignments', () => {
    const input = [
      'const apiKey = "s3cr3tValue123";',
      '"client_secret": "abcDEF123456"',
      'DB_PASSWORD=hunter2hunter2',
      'Authorization: Bearer abcdefghijklmnopqrstuvwxyz',
      'postgres://admin:P4ssw0rd!@db.internal:5432/app'
    ].join('\n');
    const { text, counts } = redactSensitive(input);
    expect(text).toBe(
      [
        `const apiKey = "${PLACEHOLDER.secret}";`,
        `"client_secret": "${PLACEHOLDER.secret}"`,
        `DB_PASSWORD=${PLACEHOLDER.secret}`,
        `Authorization: Bearer ${PLACEHOLDER.secret}`,
        `postgres://admin:${PLACEHOLDER.secret}@db.internal:5432/app`
      ].join('\n')
    );
    expect(counts.secrets).toBe(5);
  });

  it('masks private key blocks and e-mail addresses', () => {
    const input =
      '-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA\n-----END RSA PRIVATE KEY-----\n' +
      'contact: john.doe@sisal.com';
    const { text, counts } = redactSensitive(input);
    expect(text).toBe(`${PLACEHOLDER.privateKey}\ncontact: ${PLACEHOLDER.email}`);
    expect(counts.secrets).toBe(1);
    expect(counts.email).toBe(1);
  });

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

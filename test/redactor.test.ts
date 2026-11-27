import { describe, it, expect } from 'vitest';
import { redactSensitive, PLACEHOLDER } from '../src/core/redactor';

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
});

describe('redactSensitive - bounded patterns', () => {
  it('still masks long but realistic names, addresses and schemes', () => {
    const input = [
      `${'x'.repeat(100)}@mail.example.co.uk`,
      'my.deeply.nested.service.config.api_key = "abcdef123456"',
      'postgresql+asyncpg://user:pw123456@db.internal/app',
      '  export STRIPE_SECRET_KEY=abcdef123456'
    ].join('\n');
    const { text, counts } = redactSensitive(input);
    expect(text).toBe(
      [
        PLACEHOLDER.email,
        `my.deeply.nested.service.config.api_key = "${PLACEHOLDER.secret}"`,
        `postgresql+asyncpg://user:${PLACEHOLDER.secret}@db.internal/app`,
        `  export STRIPE_SECRET_KEY=${PLACEHOLDER.secret}`
      ].join('\n')
    );
    expect(counts.email).toBe(1);
    expect(counts.secrets).toBe(3);
  });

  it.each([
    ['a long dotted run', 'a.'.repeat(50_000)],
    ['a long dashed run', 'a-'.repeat(50_000)],
    ['a long run of blank lines', '\n'.repeat(100_000)]
  ])('stays fast on %s', (_name, input) => {
    const started = performance.now();
    redactSensitive(input);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});

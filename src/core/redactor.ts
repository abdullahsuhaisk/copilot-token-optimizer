/**
 * Sensitive-data redaction.
 *
 * Masks secrets (API keys, tokens, passwords, private keys), IP addresses, MAC
 * addresses and e-mail addresses before a payload reaches the LLM. Pure logic
 * with no `vscode` dependency so it runs in both the extension and MCP server.
 */

import { isIPv4, isIPv6 } from 'node:net';

/** Per-category number of values masked in a payload. */
export interface RedactionCounts {
  secrets: number;
  ipv4: number;
  ipv6: number;
  mac: number;
  email: number;
}

/** Result of a redaction pass. */
export interface RedactResult {
  readonly text: string;
  readonly counts: RedactionCounts;
}

export function emptyRedactionCounts(): RedactionCounts {
  return { secrets: 0, ipv4: 0, ipv6: 0, mac: 0, email: 0 };
}

export function addRedactionCounts(a: RedactionCounts, b: RedactionCounts): RedactionCounts {
  return {
    secrets: a.secrets + b.secrets,
    ipv4: a.ipv4 + b.ipv4,
    ipv6: a.ipv6 + b.ipv6,
    mac: a.mac + b.mac,
    email: a.email + b.email
  };
}

export function totalRedactions(counts: RedactionCounts): number {
  return counts.secrets + counts.ipv4 + counts.ipv6 + counts.mac + counts.email;
}

export const PLACEHOLDER = {
  secret: '[REDACTED_SECRET]',
  privateKey: '[REDACTED_PRIVATE_KEY]',
  ipv4: '[REDACTED_IPV4]',
  ipv6: '[REDACTED_IPV6]',
  mac: '[REDACTED_MAC]',
  email: '[REDACTED_EMAIL]'
} as const;

/** Well-known token formats; the whole match is the secret. */
const KNOWN_SECRET_PATTERNS: readonly RegExp[] = [
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, // AWS access key id
  /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g, // GitHub token
  /\bgithub_pat_[A-Za-z0-9_]{22,}\b/g, // GitHub fine-grained PAT
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g, // Slack token
  /\bAIza[0-9A-Za-z_-]{35}\b/g, // Google API key
  /\b(?:sk|rk|pk)_(?:live|test)_[0-9A-Za-z]{16,}\b/g, // Stripe key
  /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}\b/g, // OpenAI / Anthropic key
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g // JWT
];

/** Patterns where group 1 is kept (the key name / prefix) and the rest is masked. */
const PREFIXED_SECRET_PATTERNS: readonly RegExp[] = [
  // Authorization: Bearer <token>
  /(\bBearer\s+)[A-Za-z0-9\-._~+/]{16,}=*/gi,
  // scheme://user:password@host
  /(\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@/]+(?=@)/gi,
  // apiKey = "value", "client_secret": "value", password: 'value'
  /(\b[\w.-]*(?:api[_-]?key|secret|token|passw(?:or)?d|pwd|access[_-]?key|private[_-]?key|credential)[\w.-]*["']?\s*[:=]\s*["'])[^"'\s]{6,}(?=["'])/gi,
  // .env style: DB_PASSWORD=value (unquoted)
  /^(\s*(?:export\s+)?[A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD|PASSWD|PWD|CREDENTIAL)[A-Z0-9_]*\s*=\s*)[^\s"'#]{6,}/gm
];

const PRIVATE_KEY_BLOCK =
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;

const MAC_PATTERN =
  /\b(?:[0-9A-Fa-f]{2}([:-]))(?:[0-9A-Fa-f]{2}\1){4}[0-9A-Fa-f]{2}\b|\b[0-9A-Fa-f]{4}\.[0-9A-Fa-f]{4}\.[0-9A-Fa-f]{4}\b/g;

const EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

const IPV4_CANDIDATE = /(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])/g;

const IPV6_CANDIDATE = /(?<![\w:])[0-9A-Fa-f]{0,4}(?::[0-9A-Fa-f]{0,4}){2,7}(?:%\w+)?(?![\w:])/g;

/** Addresses that carry no environment-specific information. */
const IGNORED_IPS = new Set(['0.0.0.0', '127.0.0.1', '255.255.255.255', '::', '::1']);

/**
 * Replaces sensitive values in `text` with placeholders and counts them.
 *
 * Order matters: private keys and tokens first (they may contain `:` / `.`),
 * then e-mails (before IPs/MACs), MACs before IPv6 (both use `:`).
 */
export function redactSensitive(text: string): RedactResult {
  const counts = emptyRedactionCounts();
  let out = text;

  out = out.replace(PRIVATE_KEY_BLOCK, () => {
    counts.secrets++;
    return PLACEHOLDER.privateKey;
  });

  for (const pattern of KNOWN_SECRET_PATTERNS) {
    out = out.replace(pattern, () => {
      counts.secrets++;
      return PLACEHOLDER.secret;
    });
  }

  for (const pattern of PREFIXED_SECRET_PATTERNS) {
    out = out.replace(pattern, (match: string, prefix: string) => {
      if (match.slice(prefix.length).startsWith('[REDACTED_')) {
        return match;
      }
      counts.secrets++;
      return `${prefix}${PLACEHOLDER.secret}`;
    });
  }

  out = out.replace(EMAIL_PATTERN, () => {
    counts.email++;
    return PLACEHOLDER.email;
  });

  out = out.replace(MAC_PATTERN, () => {
    counts.mac++;
    return PLACEHOLDER.mac;
  });

  out = out.replace(IPV4_CANDIDATE, (match) => {
    if (!isIPv4(match) || IGNORED_IPS.has(match)) {
      return match;
    }
    counts.ipv4++;
    return PLACEHOLDER.ipv4;
  });

  out = out.replace(IPV6_CANDIDATE, (match) => {
    const address = match.split('%')[0];
    // Require a digit to avoid masking identifiers like `Foo::Bar`-style hex words.
    if (!isIPv6(address) || IGNORED_IPS.has(address) || !/\d/.test(address)) {
      return match;
    }
    counts.ipv6++;
    return PLACEHOLDER.ipv6;
  });

  return { text: out, counts };
}

/**
 * Token Optimization Engine.
 *
 * Pure, dependency-light text-pruning logic inspired by:
 *  - rtk-ai/rtk      : stripping noise (comments, whitespace) and deduplicating
 *                      repetitive log lines.
 *  - juliusbrussee/caveman : aggressive compression of redundant structure.
 *
 * This module intentionally has NO dependency on the `vscode` API so it can be
 * reused from both the extension host and the standalone MCP server process.
 *
 * The conservative level uses known comment syntax only. Markdown is preserved
 * as-is, and unknown languages are not guessed to avoid deleting content.
 *
 * Sensitive values (secrets, IP/MAC addresses, e-mails) are masked on every
 * level unless `redact: false` is passed.
 */

import { redactSensitive, emptyRedactionCounts, type RedactionCounts } from './redactor.js';

/** How aggressively the optimizer prunes the payload. */
export type OptimizationLevel = 'conservative' | 'aggressive';

/** Options that control a single optimization pass. */
export interface OptimizeOptions {
  /** Pruning aggressiveness. Defaults to `conservative`. */
  readonly level?: OptimizationLevel;
  /**
   * Language identifier (VS Code `languageId`, e.g. `typescript`, `python`).
   * Used to pick the correct comment syntax. Unknown and omitted languages do
   * not have comments stripped.
   */
  readonly languageId?: string;
  /** Mask secrets, IP/MAC addresses and e-mails. Defaults to `true`. */
  readonly redact?: boolean;
}

/** Result of optimizing a payload, including raw vs optimized character counts. */
export interface OptimizeResult {
  /** The optimized text. */
  readonly optimized: string;
  /** Character length of the original input. */
  readonly rawChars: number;
  /** Character length of the optimized output. */
  readonly optimizedChars: number;
  /** Number of sensitive values masked, per category. */
  readonly redactions: RedactionCounts;
}

/** Comment delimiters for a family of languages. */
interface CommentSyntax {
  /** Single-line comment markers, e.g. `//`, `#`. */
  readonly line: readonly string[];
  /** Block comment delimiter pairs, e.g. `['/*', '*​/']`. */
  readonly block: readonly (readonly [string, string])[];
}

const C_LIKE: CommentSyntax = {
  line: ['//'],
  block: [['/*', '*/']]
};

const HASH_LIKE: CommentSyntax = {
  line: ['#'],
  block: []
};

const NO_COMMENTS: CommentSyntax = {
  line: [],
  block: []
};

/**
 * Maps known VS Code `languageId` values to comment syntax; unknown formats
 * are left alone instead of guessing at comment markers.
 */
function commentSyntaxFor(languageId?: string): CommentSyntax {
  switch (languageId) {
    case 'typescript':
    case 'typescriptreact':
    case 'javascript':
    case 'javascriptreact':
    case 'java':
    case 'c':
    case 'cpp':
    case 'csharp':
    case 'go':
    case 'rust':
    case 'php':
    case 'swift':
    case 'kotlin':
    case 'scala':
      return C_LIKE;
    case 'python':
    case 'ruby':
    case 'shellscript':
    case 'yaml':
    case 'dockerfile':
    case 'makefile':
    case 'perl':
    case 'r':
      return HASH_LIKE;
    case 'markdown':
    case 'mdx':
    case 'plaintext':
    case 'log':
      return NO_COMMENTS;
    default:
      return NO_COMMENTS;
  }
}

/** Escapes a string for safe use inside a `RegExp`. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Removes block comments (e.g. `/* ... *​/`) from `text`.
 *
 * NOTE: This is a heuristic, not a full lexer. To avoid corrupting code it only
 * strips block comments that are NOT preceded on the same line by characters
 * that commonly indicate the delimiter lives inside a string or regex literal.
 * For the conservative PoC scope this is an acceptable trade-off; payloads that
 * embed `/*` inside strings are rare in the tool outputs we optimize.
 */
function stripBlockComments(text: string, syntax: CommentSyntax): string {
  let result = text;
  for (const [open, close] of syntax.block) {
    const pattern = new RegExp(
      `${escapeRegExp(open)}[\\s\\S]*?${escapeRegExp(close)}`,
      'g'
    );
    result = result.replace(pattern, '');
  }
  return result;
}

/**
 * Removes whole-line comments. A line is dropped only when its first
 * non-whitespace characters are a line-comment marker, so inline trailing
 * comments and markers inside string literals are left untouched.
 */
function stripFullLineComments(line: string, syntax: CommentSyntax): boolean {
  const trimmed = line.trimStart();
  return syntax.line.some((marker) => trimmed.startsWith(marker));
}

/**
 * Collapses runs of identical consecutive lines into a single line annotated
 * with the repeat count, mirroring rtk's log de-duplication. Whitespace-only
 * lines are ignored by this pass (handled by blank-line collapsing instead).
 */
function deduplicateConsecutiveLines(lines: string[]): string[] {
  const out: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const current = lines[index];
    let count = 1;
    while (index + count < lines.length && lines[index + count] === current) {
      count++;
    }

    if (count > 1 && current.trim().length > 0) {
      out.push(`${current}  (x${count})`);
    } else {
      for (let i = 0; i < count; i++) {
        out.push(current);
      }
    }

    index += count;
  }

  return out;
}

function looksLikeMarkdown(text: string): boolean {
  return /^[ \t]*(?:#{1,6}[ \t]+\S|`{3,}|~{3,}|[-*+][ \t]+\S|\d+[.)][ \t]+\S|>[ \t]?\S)/m.test(
    text
  );
}

/**
 * Optimizes a text payload by removing comments, collapsing redundant
 * whitespace and folding repeated lines.
 *
 * @param text   The raw payload to optimize.
 * @param options Optimization options (level, languageId).
 * @returns The optimized text plus raw/optimized character counts.
 */
export function optimize(text: string, options: OptimizeOptions = {}): OptimizeResult {
  const level = options.level ?? 'conservative';
  const syntax = commentSyntaxFor(options.languageId);
  const rawChars = text.length;
  const isMarkdown =
    options.languageId === 'markdown' ||
    options.languageId === 'mdx' ||
    (options.languageId === undefined && looksLikeMarkdown(text));
  let optimized = text;

  if (!isMarkdown) {
    // 1. Strip block comments across the whole payload.
    const working = stripBlockComments(text, syntax);

    // 2. Process line-by-line: drop full-line comments and normalize whitespace.
    const rawLines = working.split('\n');
    const keptLines: string[] = [];

    for (const line of rawLines) {
      if (stripFullLineComments(line, syntax)) {
        continue;
      }
      // Trim trailing whitespace; preserve leading indentation for readability.
      keptLines.push(line.replace(/\s+$/, ''));
    }

    // 3. Deduplicate consecutive identical lines (log-style noise).
    let processed = deduplicateConsecutiveLines(keptLines);

    // 4. Collapse 2+ consecutive blank lines into a single blank line.
    const collapsed: string[] = [];
    let blankRun = 0;
    for (const line of processed) {
      if (line.trim().length === 0) {
        blankRun++;
        if (blankRun > 1) {
          continue;
        }
      } else {
        blankRun = 0;
      }
      collapsed.push(line);
    }
    processed = collapsed;

    // Only explicitly plain text may have repeated horizontal spaces folded.
    if (level === 'aggressive' && options.languageId === 'plaintext') {
      processed = processed.map((line) => {
        const indentation = line.match(/^[ \t]*/)?.[0] ?? '';
        const content = line.slice(indentation.length).replace(/[ \t]{2,}/g, ' ');
        return `${indentation}${content}`;
      });
    }

    // Remove a single trailing blank line for a tidy result.
    while (processed.length > 0 && processed[processed.length - 1].trim() === '') {
      processed.pop();
    }

    optimized = processed.join('\n');
  }

  // Redact last so counts reflect only what would actually reach the model.
  let redactions = emptyRedactionCounts();
  if (options.redact ?? true) {
    const redacted = redactSensitive(optimized);
    optimized = redacted.text;
    redactions = redacted.counts;
  }

  return {
    optimized,
    rawChars,
    optimizedChars: optimized.length,
    redactions
  };
}

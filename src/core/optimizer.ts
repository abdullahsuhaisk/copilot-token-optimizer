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
    default:
      return NO_COMMENTS;
  }
}

const LANGUAGE_BY_EXTENSION: Readonly<Record<string, string>> = {
  ts: 'typescript',
  tsx: 'typescriptreact',
  js: 'javascript',
  jsx: 'javascriptreact',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  c: 'c',
  cpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  sh: 'shellscript',
  md: 'markdown',
  mdx: 'mdx',
  txt: 'plaintext',
  log: 'log',
  yml: 'yaml',
  yaml: 'yaml'
};

/** Maps a file path to a VS Code-style `languageId` based on its extension. */
export function languageIdFromPath(filePath: string): string | undefined {
  const extension = filePath.slice(filePath.lastIndexOf('.') + 1).toLowerCase();
  return LANGUAGE_BY_EXTENSION[extension];
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
 * Whole-line comment check. A line counts only when its first non-whitespace
 * characters are a line-comment marker, so inline trailing comments and
 * markers inside string literals are left untouched.
 */
function isFullLineComment(line: string, syntax: CommentSyntax): boolean {
  const trimmed = line.trimStart();
  return syntax.line.some((marker) => trimmed.startsWith(marker));
}

function trimTrailingWhitespace(line: string): string {
  return line.replace(/\s+$/, '');
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

    if (count > 1 && !isBlank(current)) {
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

function isBlank(line: string): boolean {
  return line.trim().length === 0;
}

/** Drops a blank line when the line before it is blank too. */
function collapseBlankLines(lines: string[]): string[] {
  return lines.filter((line, index) => !(isBlank(line) && index > 0 && isBlank(lines[index - 1])));
}

/** Folds runs of spaces/tabs into one space, keeping leading indentation. */
function foldRepeatedSpaces(line: string): string {
  const indentation = line.match(/^[ \t]*/)?.[0] ?? '';
  const content = line.slice(indentation.length).replace(/[ \t]{2,}/g, ' ');
  return `${indentation}${content}`;
}

function trimTrailingBlankLines(lines: string[]): string[] {
  let end = lines.length;
  while (end > 0 && isBlank(lines[end - 1])) {
    end--;
  }
  return lines.slice(0, end);
}

function isMarkdown(text: string, languageId?: string): boolean {
  if (languageId === 'markdown' || languageId === 'mdx') {
    return true;
  }
  return languageId === undefined && looksLikeMarkdown(text);
}

function looksLikeMarkdown(text: string): boolean {
  return /^[ \t]*(?:#{1,6}[ \t]+\S|`{3,}|~{3,}|[-*+][ \t]+\S|\d+[.)][ \t]+\S|>[ \t]?\S)/m.test(
    text
  );
}

/** Removes comments and redundant whitespace/lines from a non-Markdown payload. */
function prune(text: string, options: OptimizeOptions): string {
  const syntax = commentSyntaxFor(options.languageId);

  let lines = stripBlockComments(text, syntax)
    .split('\n')
    .filter((line) => !isFullLineComment(line, syntax))
    .map(trimTrailingWhitespace);
  lines = deduplicateConsecutiveLines(lines);
  lines = collapseBlankLines(lines);

  // Only explicitly plain text may have repeated horizontal spaces folded.
  if (options.level === 'aggressive' && options.languageId === 'plaintext') {
    lines = lines.map(foldRepeatedSpaces);
  }

  return trimTrailingBlankLines(lines).join('\n');
}

/**
 * Optimizes a text payload by removing comments, collapsing redundant
 * whitespace and folding repeated lines, then masking sensitive values.
 *
 * @param text   The raw payload to optimize.
 * @param options Optimization options (level, languageId, redact).
 * @returns The optimized text plus raw/optimized character counts.
 */
export function optimize(text: string, options: OptimizeOptions = {}): OptimizeResult {
  const pruned = isMarkdown(text, options.languageId) ? text : prune(text, options);

  // Redact last so counts reflect only what would actually reach the model.
  const { text: optimized, counts: redactions } = (options.redact ?? true)
    ? redactSensitive(pruned)
    : { text: pruned, counts: emptyRedactionCounts() };

  return {
    optimized,
    rawChars: text.length,
    optimizedChars: optimized.length,
    redactions
  };
}

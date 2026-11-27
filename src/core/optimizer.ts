/**
 * Token optimization engine.
 *
 * Pure, dependency-light text-pruning logic inspired by:
 *  - rtk-ai/rtk      : stripping noise (comments, whitespace) and folding
 *                      repetitive log lines.
 *  - juliusbrussee/caveman : aggressive compression of redundant structure.
 *
 * This module intentionally has NO dependency on the `vscode` API so it can be
 * reused from both the extension host and the standalone MCP server process.
 *
 * The default level only removes what carries no meaning: whole-line comments
 * of known languages, trailing whitespace and blank lines. Markdown is kept
 * as-is, unknown languages are never guessed at, and repeated lines are folded
 * only for logs and plain text, never for code or data.
 *
 * Sensitive values (secrets, IP/MAC addresses, e-mails) are masked on every
 * level unless `redact: false` is passed.
 */

import { commentSyntaxFor } from './languages.js';
import {
  collapseBlankLines,
  foldRepeatedLines,
  foldRepeatedSpaces,
  stripFullLineComments,
  trimTrailingBlankLines,
  trimTrailingWhitespace
} from './line-transforms.js';
import { emptyRedactionCounts, redactSensitive, type RedactionCounts } from './redactor.js';

/** How aggressively the optimizer prunes the payload. */
export type OptimizationLevel = 'conservative' | 'aggressive';

/** Options that control a single optimization pass. */
export interface OptimizeOptions {
  /** Pruning aggressiveness. Defaults to `conservative`. */
  readonly level?: OptimizationLevel;
  /**
   * Language identifier (VS Code `languageId`, e.g. `typescript`, `python`).
   * Used to pick the comment syntax. Unknown and omitted languages do not have
   * comments stripped. Use `log` for logs and terminal output and `plaintext`
   * for prose: only those two fold repeated lines.
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

/**
 * Languages whose repeated consecutive lines can be folded into `line  (xN)`
 * without changing what the text says. Code and data (arrays, tables, markup)
 * can repeat a line legitimately, so folding it would alter the content.
 */
const REPEAT_FOLDING_LANGUAGES: ReadonlySet<string> = new Set(['log', 'plaintext']);

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
  const { languageId } = options;
  const syntax = commentSyntaxFor(languageId);

  let lines = stripFullLineComments(text.split('\n'), syntax).map(trimTrailingWhitespace);
  if (languageId !== undefined && REPEAT_FOLDING_LANGUAGES.has(languageId)) {
    lines = foldRepeatedLines(lines);
  }
  lines = collapseBlankLines(lines);

  // Only explicitly plain text may have repeated horizontal spaces folded.
  if (options.level === 'aggressive' && languageId === 'plaintext') {
    lines = lines.map(foldRepeatedSpaces);
  }

  return trimTrailingBlankLines(lines).join('\n');
}

/**
 * Optimizes a text payload by removing whole-line comments, collapsing
 * redundant whitespace and (for logs and plain text) folding repeated lines,
 * then masking sensitive values.
 *
 * @param text    The raw payload to optimize.
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

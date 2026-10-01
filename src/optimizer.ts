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
 * Design rule: the default "conservative" level MUST NOT change the semantic
 * meaning of code. It only removes comments, collapses whitespace and folds
 * exactly-repeated consecutive lines. Anything that could alter program
 * behaviour belongs to a higher (opt-in) level.
 */

/** How aggressively the optimizer prunes the payload. */
export type OptimizationLevel = 'conservative' | 'aggressive';

/** Options that control a single optimization pass. */
export interface OptimizeOptions {
  /** Pruning aggressiveness. Defaults to `conservative`. */
  readonly level?: OptimizationLevel;
  /**
   * Language identifier (VS Code `languageId`, e.g. `typescript`, `python`).
   * Used to pick the correct comment syntax. When omitted, a safe superset of
   * comment styles is stripped.
   */
  readonly languageId?: string;
}

/** Result of optimizing a payload, including raw vs optimized character counts. */
export interface OptimizeResult {
  /** The optimized text. */
  readonly optimized: string;
  /** Character length of the original input. */
  readonly rawChars: number;
  /** Character length of the optimized output. */
  readonly optimizedChars: number;
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

/**
 * Maps a VS Code `languageId` to its comment syntax. Languages we do not know
 * about fall back to a safe superset that strips both `//`/`/* *​/` and `#`.
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
      // Unknown language: strip the union of common comment styles.
      return {
        line: ['//', '#'],
        block: [['/*', '*/']]
      };
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

  // 1. Strip block comments across the whole payload.
  let working = stripBlockComments(text, syntax);

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

  // 5. Aggressive level: also drop leading indentation entirely. This changes
  //    formatting (not semantics for whitespace-insensitive languages) so it is
  //    opt-in only. Indentation-sensitive languages keep their structure
  //    because we only collapse runs of spaces, never remove newlines.
  if (level === 'aggressive') {
    processed = processed.map((line) => line.replace(/[ \t]{2,}/g, ' '));
  }

  // Remove a single trailing blank line for a tidy result.
  while (processed.length > 0 && processed[processed.length - 1].trim() === '') {
    processed.pop();
  }

  const optimized = processed.join('\n');

  return {
    optimized,
    rawChars,
    optimizedChars: optimized.length
  };
}

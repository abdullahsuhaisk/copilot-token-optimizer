/**
 * Line-level text transforms used by the optimizer. Every function is pure:
 * lines in, lines out. They only remove content that carries no meaning to a
 * reader (whole-line comments, trailing spaces, blank or repeated lines).
 */

import type { CommentSyntax } from './languages.js';

export function isBlank(line: string): boolean {
  return line.trim().length === 0;
}

export function trimTrailingWhitespace(line: string): string {
  return line.trimEnd();
}

/**
 * Removes comments that occupy whole lines: line comments that start a line,
 * and block comments that start a line and have nothing but whitespace after
 * their closing delimiter.
 *
 * Comments that share a line with code are left alone. Telling them apart from
 * comment-like text inside a string literal (a glob pattern, for example) needs
 * a real parser, and guessing wrong deletes code. A block comment that is never
 * closed is left alone too.
 */
export function stripFullLineComments(lines: readonly string[], syntax: CommentSyntax): string[] {
  const kept: string[] = [];
  // A block comment that started on a whole line and is waiting for its end.
  let open: { readonly close: string; readonly lines: string[] } | undefined;

  for (const line of lines) {
    if (open) {
      open.lines.push(line);
      const rest = textAfter(line, open.close, 0);
      if (rest === undefined) {
        continue;
      }
      if (!isBlank(rest)) {
        appendAll(kept, open.lines);
      }
      open = undefined;
      continue;
    }

    const block = blockCommentStartedBy(line, syntax);
    if (block) {
      const [opener, close] = block;
      const rest = textAfter(line, close, line.indexOf(opener) + opener.length);
      if (rest === undefined) {
        open = { close, lines: [line] };
      } else if (!isBlank(rest)) {
        kept.push(line);
      }
      continue;
    }

    if (!startsWithLineComment(line, syntax)) {
      kept.push(line);
    }
  }

  if (open) {
    appendAll(kept, open.lines);
  }
  return kept;
}

function blockCommentStartedBy(
  line: string,
  syntax: CommentSyntax
): readonly [open: string, close: string] | undefined {
  const trimmed = line.trimStart();
  return syntax.block.find(([opener]) => trimmed.startsWith(opener));
}

function startsWithLineComment(line: string, syntax: CommentSyntax): boolean {
  const trimmed = line.trimStart();
  return syntax.line.some((marker) => trimmed.startsWith(marker));
}

/** The text after the first `delimiter` found at or after `from`, if any. */
function textAfter(line: string, delimiter: string, from: number): string | undefined {
  const at = line.indexOf(delimiter, from);
  return at === -1 ? undefined : line.slice(at + delimiter.length);
}

// push(...items) overflows the call stack for very large arrays.
function appendAll(target: string[], items: readonly string[]): void {
  for (const item of items) {
    target.push(item);
  }
}

/**
 * Collapses runs of identical consecutive lines into a single line annotated
 * with the repeat count, mirroring rtk's log de-duplication. Whitespace-only
 * lines are ignored by this pass (handled by blank-line collapsing instead).
 */
export function foldRepeatedLines(lines: readonly string[]): string[] {
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

/** Drops a blank line when the line before it is blank too. */
export function collapseBlankLines(lines: readonly string[]): string[] {
  return lines.filter((line, index) => !(isBlank(line) && index > 0 && isBlank(lines[index - 1])));
}

/** Folds runs of spaces/tabs into one space, keeping leading indentation. */
export function foldRepeatedSpaces(line: string): string {
  const indentation = line.match(/^[ \t]*/)?.[0] ?? '';
  const content = line.slice(indentation.length).replace(/[ \t]{2,}/g, ' ');
  return `${indentation}${content}`;
}

export function trimTrailingBlankLines(lines: readonly string[]): string[] {
  let end = lines.length;
  while (end > 0 && isBlank(lines[end - 1])) {
    end--;
  }
  return lines.slice(0, end);
}

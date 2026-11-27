/**
 * Language tables for the optimizer: which comment syntax a VS Code
 * `languageId` uses, and which `languageId` a file extension implies.
 *
 * Unknown languages map to "no comments" on purpose. The optimizer never
 * guesses comment markers, because deleting real content is worse than keeping
 * a few extra tokens.
 */

import { extname } from 'node:path';

/** Comment delimiters for a family of languages. */
export interface CommentSyntax {
  /** Single-line comment markers, e.g. `//` or `#`. */
  readonly line: readonly string[];
  /** Block comment delimiter pairs, as `[open, close]`. */
  readonly block: readonly (readonly [open: string, close: string])[];
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

/** Maps a VS Code `languageId` to its comment syntax; unknown ids have none. */
export function commentSyntaxFor(languageId?: string): CommentSyntax {
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

const LANGUAGE_BY_EXTENSION: ReadonlyMap<string, string> = new Map([
  ['ts', 'typescript'],
  ['tsx', 'typescriptreact'],
  ['js', 'javascript'],
  ['jsx', 'javascriptreact'],
  ['py', 'python'],
  ['rb', 'ruby'],
  ['go', 'go'],
  ['rs', 'rust'],
  ['java', 'java'],
  ['c', 'c'],
  ['cpp', 'cpp'],
  ['cs', 'csharp'],
  ['php', 'php'],
  ['sh', 'shellscript'],
  ['md', 'markdown'],
  ['mdx', 'mdx'],
  ['txt', 'plaintext'],
  ['log', 'log'],
  ['yml', 'yaml'],
  ['yaml', 'yaml']
]);

/** Maps a file path to a VS Code-style `languageId` based on its extension. */
export function languageIdFromPath(filePath: string): string | undefined {
  return LANGUAGE_BY_EXTENSION.get(extname(filePath).slice(1).toLowerCase());
}

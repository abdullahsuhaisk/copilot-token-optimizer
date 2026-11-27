/**
 * Confines user-supplied file paths to a workspace root, so a tool call can
 * never read files outside the project (path traversal, OWASP A01).
 */

import { promises as fs } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

const READS_DISABLED_MESSAGE = 'File reads are disabled: no workspace root configured.';
const ESCAPES_ROOT_MESSAGE = 'File access blocked: path escapes the workspace root.';

/**
 * Resolves `inputPath` (absolute, or relative to the root) and returns the real
 * absolute path of the file it names.
 *
 * Rejects `..` traversal, absolute paths elsewhere, and symlinks that lead out
 * of the root. The returned path has its symlinks resolved, so read from it
 * rather than from `inputPath`.
 *
 * @throws If file reads are disabled, the path escapes the root, or the file does not exist.
 */
export async function resolveWithinWorkspace(
  workspaceRoot: string | undefined,
  inputPath: string
): Promise<string> {
  if (!workspaceRoot) {
    throw new Error(READS_DISABLED_MESSAGE);
  }

  const root = resolve(workspaceRoot);
  const candidate = resolve(root, inputPath);
  // Check the spelled-out path first, so a path outside the root never reveals
  // whether the file exists.
  assertInside(root, candidate);

  // A symlink inside the root can point anywhere: check where the path really ends up.
  const [realRoot, realCandidate] = await Promise.all([
    fs.realpath(root),
    fs.realpath(candidate)
  ]);
  assertInside(realRoot, realCandidate);
  return realCandidate;
}

function assertInside(root: string, target: string): void {
  const rel = relative(root, target);
  // Only a real parent reference escapes: a folder that merely starts with two
  // dots (such as "..hidden") is a normal child.
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(ESCAPES_ROOT_MESSAGE);
  }
}

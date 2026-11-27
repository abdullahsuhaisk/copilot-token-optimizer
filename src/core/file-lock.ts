/**
 * Cross-process lock built on atomic `mkdir`.
 *
 * Every VS Code window runs its own MCP server against the same global stats
 * file, so without a lock their concurrent read-modify-write updates would
 * overwrite each other.
 */

import { promises as fs } from 'node:fs';

export interface LockOptions {
  /** Pause between attempts to take a lock that is held. */
  readonly retryMs?: number;
  /** How long to keep trying before giving up. */
  readonly timeoutMs?: number;
  /** A lock older than this belongs to a crashed process and is reclaimed. */
  readonly staleMs?: number;
}

const DEFAULT_OPTIONS: Required<LockOptions> = {
  retryMs: 20,
  timeoutMs: 5_000,
  staleMs: 10_000
};

/** Runs `fn` while holding a cross-process lock on `filePath`. */
export async function withFileLock<T>(
  filePath: string,
  fn: () => Promise<T>,
  options: LockOptions = {}
): Promise<T> {
  const lockPath = `${filePath}.lock`;
  await acquireLock(lockPath, { ...DEFAULT_OPTIONS, ...options });
  try {
    return await fn();
  } finally {
    await fs.rm(lockPath, { recursive: true, force: true });
  }
}

/** `mkdir` is atomic, so whichever process creates the directory owns the lock. */
async function acquireLock(lockPath: string, options: Required<LockOptions>): Promise<void> {
  const deadline = Date.now() + options.timeoutMs;
  for (;;) {
    try {
      await fs.mkdir(lockPath);
      return;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw err;
      }
    }

    // A lock left behind by a crashed process is reclaimed after a while.
    const stat = await fs.stat(lockPath).catch(() => undefined);
    if (stat && Date.now() - stat.mtimeMs > options.staleMs) {
      await fs.rm(lockPath, { recursive: true, force: true });
      continue;
    }
    if (Date.now() > deadline) {
      throw new Error(`Timed out acquiring stats lock: ${lockPath}`);
    }
    await new Promise((resolve) => setTimeout(resolve, options.retryMs));
  }
}

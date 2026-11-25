import { promises as fs } from 'node:fs';

const LOCK_RETRY_MS = 20;
const LOCK_TIMEOUT_MS = 5_000;
const LOCK_STALE_MS = 10_000;

/**
 * Runs `fn` while holding a cross-process lock on `filePath`. Every VS Code
 * window runs its own MCP server against the same global stats file, so without
 * this lock concurrent read-modify-write updates would overwrite each other.
 */
export async function withFileLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  const lockPath = `${filePath}.lock`;
  await acquireLock(lockPath);
  try {
    return await fn();
  } finally {
    await fs.rm(lockPath, { recursive: true, force: true });
  }
}

/** `mkdir` is atomic, so whichever process creates the directory owns the lock. */
async function acquireLock(lockPath: string): Promise<void> {
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
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
    if (stat && Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
      await fs.rm(lockPath, { recursive: true, force: true });
      continue;
    }
    if (Date.now() > deadline) {
      throw new Error(`Timed out acquiring stats lock: ${lockPath}`);
    }
    await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS));
  }
}

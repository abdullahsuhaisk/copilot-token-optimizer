import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, stat, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withFileLock } from '../src/core/file-lock';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('withFileLock', () => {
  let directory: string;
  let target: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'ai-token-optimizer-'));
    target = join(directory, 'stats.json');
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('runs critical sections one at a time', async () => {
    let running = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 8 }, () =>
        withFileLock(target, async () => {
          running++;
          peak = Math.max(peak, running);
          await sleep(5);
          running--;
        })
      )
    );
    expect(peak).toBe(1);
  });

  it('releases the lock when the callback throws', async () => {
    await expect(withFileLock(target, () => Promise.reject(new Error('boom')))).rejects.toThrow(
      'boom'
    );

    await expect(stat(`${target}.lock`)).rejects.toThrow();
    expect(await withFileLock(target, () => Promise.resolve('ok'))).toBe('ok');
  });

  it('reclaims a lock left behind by a crashed process', async () => {
    await mkdir(`${target}.lock`);
    const longAgo = new Date(Date.now() - 60_000);
    await utimes(`${target}.lock`, longAgo, longAgo);

    expect(await withFileLock(target, () => Promise.resolve('ok'))).toBe('ok');
  });

  it('gives up when a fresh lock is never released', async () => {
    await mkdir(`${target}.lock`);

    await expect(
      withFileLock(target, () => Promise.resolve('ok'), { timeoutMs: 100, retryMs: 10 })
    ).rejects.toThrow('Timed out acquiring stats lock');
  });
});

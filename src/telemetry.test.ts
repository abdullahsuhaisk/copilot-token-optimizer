import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  emptyStats,
  estimateSavedAICredits,
  readStats,
  recordSavings
} from './telemetry';

describe('estimateSavedAICredits', () => {
  it('converts saved input tokens using the configured per-million-token price', () => {
    expect(estimateSavedAICredits(250_000, 1.2)).toBe(30);
  });

  it('returns zero when no tokens or no price are configured', () => {
    expect(estimateSavedAICredits(0, 1)).toBe(0);
    expect(estimateSavedAICredits(1_000_000, 0)).toBe(0);
  });
});

describe('emptyStats', () => {
  it('initializes the estimated AI credit total', () => {
    expect(emptyStats().totalEstimatedSavedAICredits).toBe(0);
  });
});

describe('recordSavings', () => {
  it('adds estimates to existing stats and reads legacy stats without the new field', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ai-token-optimizer-'));
    const filePath = join(directory, 'stats.json');
    try {
      await writeFile(
        filePath,
        JSON.stringify({
          calls: 1,
          totalRawTokens: 100,
          totalOptimizedTokens: 75,
          totalSavedTokens: 25,
          redactions: emptyStats().redactions
        })
      );
      expect((await readStats(filePath, 2)).totalEstimatedSavedAICredits).toBe(0.005);

      const updated = await recordSavings(
        filePath,
        { rawTokens: 100, optimizedTokens: 50, savedTokens: 50, savedPct: 50 },
        emptyStats().redactions,
        2
      );

      expect(updated.totalEstimatedSavedAICredits).toBe(0.015);
      expect(JSON.parse(await readFile(filePath, 'utf8')).totalEstimatedSavedAICredits)
        .toBe(0.015);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('accumulates concurrent writes from multiple windows without losing any', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ai-token-optimizer-'));
    const filePath = join(directory, 'stats.json');
    try {
      await Promise.all(
        Array.from({ length: 20 }, () =>
          recordSavings(filePath, { rawTokens: 10, optimizedTokens: 5, savedTokens: 5, savedPct: 50 })
        )
      );
      const stats = await readStats(filePath);
      expect(stats.calls).toBe(20);
      expect(stats.totalSavedTokens).toBe(100);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

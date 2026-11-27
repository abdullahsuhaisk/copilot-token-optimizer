import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { estimateSavedAICredits } from '../src/core/credits';
import { emptyStats, readStats, recordSavings } from '../src/core/stats-store';
import { countTokens } from '../src/core/tokens';

describe('emptyStats', () => {
  it('initializes the estimated AI credit total', () => {
    expect(emptyStats().totalEstimatedSavedAICredits).toBe(0);
    expect(emptyStats().responseCalls).toBe(0);
    expect(emptyStats().totalNetSavedTokens).toBe(0);
  });
});

describe('readStats', () => {
  it('copies only known numeric fields and falls back to empty stats for a corrupt file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ai-token-optimizer-'));
    const filePath = join(directory, 'stats.json');
    try {
      await writeFile(
        filePath,
        JSON.stringify({ calls: 'many', totalRawTokens: 5, bogus: 1, redactions: { secrets: 2 } })
      );
      const stats = await readStats(filePath);
      expect(stats.calls).toBe(0);
      expect(stats.totalRawTokens).toBe(5);
      expect(stats).not.toHaveProperty('bogus');
      expect(stats.redactions).toEqual({ ...emptyStats().redactions, secrets: 2 });

      await writeFile(filePath, '{ not json');
      expect(await readStats(filePath)).toEqual(emptyStats());
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
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
      expect(
        (JSON.parse(await readFile(filePath, 'utf8')) as { totalEstimatedSavedAICredits: number })
          .totalEstimatedSavedAICredits
      ).toBe(0.015);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('measures the complete reply, including its summary, and records net token growth', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ai-token-optimizer-'));
    const filePath = join(directory, 'stats.json');
    try {
      const input = 'source text';
      const response = 'Payload summary with token counts\nA longer returned body.';
      const rawTokens = countTokens(input);
      const responseTokens = countTokens(response);
      expect(responseTokens).toBeGreaterThan(rawTokens);

      const updated = await recordSavings(
        filePath,
        {
          rawTokens,
          optimizedTokens: 4,
          savedTokens: rawTokens - 4,
          savedPct: ((rawTokens - 4) / rawTokens) * 100,
          responseTokens
        },
        emptyStats().redactions,
        2
      );

      expect(updated.responseCalls).toBe(1);
      expect(updated.totalResponseInputTokens).toBe(rawTokens);
      expect(updated.totalResponseTokens).toBe(responseTokens);
      expect(updated.totalNetSavedTokens).toBe(rawTokens - responseTokens);
      expect(updated.totalEstimatedNetSavedAICredits)
        .toBe(estimateSavedAICredits(rawTokens - responseTokens, 2));
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

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_INPUT_PRICE_PER_MILLION_USD } from '../src/core/credits';

interface Manifest {
  version: string;
  engines: { vscode: string };
  contributes: {
    configuration: { properties: Record<string, { default: unknown }> };
  };
}

function readJson<T>(...parts: string[]): T {
  return JSON.parse(readFileSync(join(process.cwd(), ...parts), 'utf8')) as T;
}

/** [major, minor] of the first version number in a range such as "^1.101.0". */
function majorMinor(range: string): [number, number] {
  const [major, minor] = range.match(/\d+/g)?.map(Number) ?? [];
  return [major, minor];
}

describe('package manifest', () => {
  const manifest = readJson<Manifest>('package.json');

  it('declares the same default input price as the code', () => {
    const setting =
      manifest.contributes.configuration.properties['aiTokenOptimizer.aiCreditInputPricePerMillionUsd'];
    expect(setting.default).toBe(DEFAULT_INPUT_PRICE_PER_MILLION_USD);
  });

  it('is not compiled against newer VS Code typings than the engine it declares', () => {
    const [engineMajor, engineMinor] = majorMinor(manifest.engines.vscode);
    const types = readJson<{ version: string }>('node_modules', '@types', 'vscode', 'package.json');
    const [typesMajor, typesMinor] = majorMinor(types.version);

    // A newer typings package lets code use APIs the declared engine lacks, and
    // the compiler cannot catch it.
    expect(typesMajor * 1000 + typesMinor).toBeLessThanOrEqual(engineMajor * 1000 + engineMinor);
  });
});

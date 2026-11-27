/**
 * Server configuration. The extension passes it through environment variables;
 * other MCP clients (Claude Code, Cursor, ...) can set the same variables.
 */

import { readFileSync } from 'node:fs';
import { DEFAULT_INPUT_PRICE_PER_MILLION_USD } from '../core/credits.js';

export interface ServerConfig {
  /** Reported to MCP clients as the server version. */
  readonly version: string;
  /** Absolute path of the shared stats JSON file. Telemetry is off when unset. */
  readonly statsFile: string | undefined;
  /** Root the file-reading tool is confined to. File reads are disabled when unset. */
  readonly workspaceRoot: string | undefined;
  /** Model input price (USD per 1M tokens) used for the AI-credit estimate. */
  readonly inputPricePerMillionUsd: number;
}

/**
 * Reads the configuration from `env`.
 *
 * @throws If `AI_CREDIT_INPUT_PRICE_PER_MILLION_USD` is not a non-negative number.
 */
export function loadServerConfig(env: NodeJS.ProcessEnv, version: string): ServerConfig {
  return {
    version,
    statsFile: nonEmpty(env.STATS_FILE),
    workspaceRoot: nonEmpty(env.WORKSPACE_ROOT),
    inputPricePerMillionUsd: readInputPrice(env.AI_CREDIT_INPUT_PRICE_PER_MILLION_USD)
  };
}

/** The version in the extension's `package.json`, so the server reports the same one. */
export function readPackageVersion(packageJsonPath: string): string {
  const { version } = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { version?: unknown };
  return typeof version === 'string' ? version : '0.0.0';
}

/** An empty variable counts as unset: the extension passes "" when no folder is open. */
function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value === '' ? undefined : value;
}

function readInputPrice(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') {
    return DEFAULT_INPUT_PRICE_PER_MILLION_USD;
  }
  const price = Number(raw);
  if (!Number.isFinite(price) || price < 0) {
    throw new Error('AI_CREDIT_INPUT_PRICE_PER_MILLION_USD must be a non-negative number.');
  }
  return price;
}

/**
 * AI Token Optimizer — MCP server entry point (stdio transport).
 *
 * This standalone Node process is spawned by the VS Code extension and exposes
 * "optimization" tools to the agent. When the agent calls a tool, the tool runs
 * a payload through the optimizer and returns the *optimized* text, so fewer
 * tokens enter the model's context window. Each call's savings are folded into
 * a shared stats file (path provided via the `STATS_FILE` env var) that the
 * extension watches to render real-time telemetry.
 *
 * Interception model: optimization happens at the MCP tool-output boundary.
 * This is the feasible, supported way for an extension to reduce context — VS
 * Code does not expose an API to transparently rewrite Copilot's own prompt.
 *
 * The server itself lives in `mcp/`; this file only wires configuration to a
 * stdio transport.
 */

import { join } from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadServerConfig, readPackageVersion } from './mcp/config.js';
import { errorMessage } from './mcp/diagnostics.js';
import { createServer } from './mcp/server.js';

async function main(): Promise<void> {
  // Resolved relative to the compiled `out/mcp-server.js`.
  const version = readPackageVersion(join(__dirname, '..', 'package.json'));
  const config = loadServerConfig(process.env, version);
  await createServer(config).connect(new StdioServerTransport());
}

main().catch((err: unknown) => {
  // Surface fatal startup errors on stderr (visible in the MCP server output log).
  const detail = err instanceof Error ? (err.stack ?? errorMessage(err)) : errorMessage(err);
  process.stderr.write(`[ai-token-optimizer] fatal: ${detail}\n`);
  process.exit(1);
});

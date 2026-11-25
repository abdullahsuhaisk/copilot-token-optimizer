/**
 * AI Token Optimizer — MCP server (stdio transport).
 *
 * This standalone Node process is spawned by the VS Code extension and exposes
 * "optimization" tools to the agent. When the agent calls a tool, the tool runs
 * a payload through the {@link optimize} engine and returns the *optimized*
 * text, so fewer tokens enter the model's context window. Each call's savings
 * are folded into a shared stats file (path provided via the `STATS_FILE` env
 * var) that the extension watches to render real-time telemetry.
 *
 * Interception model: optimization happens at the MCP tool-output boundary.
 * This is the feasible, supported way for an extension to reduce context — VS
 * Code does not expose an API to transparently rewrite Copilot's own prompt.
 */

import { resolve, relative, isAbsolute } from 'node:path';
import { promises as fs } from 'node:fs';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { languageIdFromPath, optimize, type OptimizeOptions } from './core/optimizer.js';
import {
  countTokens,
  measureSavings,
  readStats,
  recordSavings,
  type SavingsRecord
} from './core/telemetry.js';
import { formatToolStatsReport, formatToolSummary } from './core/format.js';
import type { RedactionCounts } from './core/redactor.js';

// Resolved relative to the compiled `out/mcp-server.js`.
const { version: PACKAGE_VERSION } = require('../package.json') as { version: string };

/** Absolute path to the shared stats JSON file, supplied by the extension. */
const STATS_FILE = process.env.STATS_FILE;

/**
 * Workspace root the file-reading tool is confined to. Supplied by the
 * extension. When unset, file reads are disabled for safety.
 */
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT;
const INPUT_PRICE_PER_MILLION_USD = readInputPricePerMillionUsd();

const levelSchema = z
  .enum(['conservative', 'aggressive'])
  .optional()
  .describe(
    'Pruning level. Aggressive folds repeated spaces only when languageId is explicitly plaintext.'
  );

/**
 * Optimizes `rawText`, records the savings and returns the tool reply: a
 * one-line savings summary followed by the optimized text.
 */
async function optimizedReply(rawText: string, options: OptimizeOptions) {
  const result = optimize(rawText, options);
  const savings = measureSavings(rawText, result.optimized);
  const reply =
    `${formatToolSummary(savings, result.redactions, INPUT_PRICE_PER_MILLION_USD)}\n` +
    result.optimized;

  // Never log payload text: even optimized output is only as safe as the redactor.
  log(`optimized ${savings.rawTokens} -> ${savings.optimizedTokens} tokens`);
  await recordStats({ ...savings, responseTokens: countTokens(reply) }, result.redactions);
  return textResult(reply);
}

/** Telemetry is best-effort: failures are logged but never break a tool call. */
async function recordStats(record: SavingsRecord, redactions: RedactionCounts): Promise<void> {
  if (!STATS_FILE) {
    return;
  }
  try {
    await recordSavings(STATS_FILE, record, redactions, INPUT_PRICE_PER_MILLION_USD);
  } catch (err) {
    log(`failed to record stats: ${(err as Error).message}`);
  }
}

/**
 * Resolves a user-supplied path against the workspace root and rejects any path
 * that escapes it (path-traversal / absolute-path containment, OWASP A01/A05).
 *
 * @throws If file reads are disabled or the path escapes the workspace.
 */
function resolveWithinWorkspace(inputPath: string): string {
  if (!WORKSPACE_ROOT) {
    throw new Error('File reads are disabled: no workspace root configured.');
  }
  const root = resolve(WORKSPACE_ROOT);
  const candidate = isAbsolute(inputPath)
    ? resolve(inputPath)
    : resolve(root, inputPath);

  const rel = relative(root, candidate);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('File access blocked: path escapes the workspace root.');
  }
  return candidate;
}

function readInputPricePerMillionUsd(): number {
  const raw = process.env.AI_CREDIT_INPUT_PRICE_PER_MILLION_USD;
  const price = raw === undefined ? 1 : Number(raw);
  if (!Number.isFinite(price) || price < 0) {
    throw new Error('AI_CREDIT_INPUT_PRICE_PER_MILLION_USD must be a non-negative number.');
  }
  return price;
}

function textResult(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

function errorResult(message: string) {
  return { isError: true, content: [{ type: 'text' as const, text: message }] };
}

function log(message: string): void {
  process.stderr.write(`[ai-token-optimizer] ${message}\n`);
}

function createServer(): McpServer {
  const server = new McpServer({
    name: 'ai-token-optimizer',
    version: PACKAGE_VERSION
  });

  // Tool 1: optimize an arbitrary text/code payload. // NOTE:DELETE IT IF ANOTHER LLM DON'T USE OR CHECK
  server.registerTool(
    'optimize_context',
    {
      title: 'Optimize Context',
      description:
        'Use this to shrink any large text or code payload (logs, terminal ' +
        'output, pasted code, API responses) before reasoning over it. Prunes ' +
        'and compresses (strips comments only for known languages and collapses ' +
        'redundant lines) so it consumes fewer tokens. Markdown is preserved; ' +
        'aggressive space folding is limited to explicit plaintext. It masks ' +
        'secrets, IP/MAC ' +
        'addresses and e-mails. Returns the optimized text plus a token-savings ' +
        'and redaction summary.',
      inputSchema: {
        text: z.string().describe('The raw text or code to optimize.'),
        languageId: z
          .string()
          .optional()
          .describe('VS Code languageId (e.g. typescript, python) for comment syntax.'),
        level: levelSchema
      },
      annotations: { readOnlyHint: true }
    },
    async ({ text, languageId, level }) => optimizedReply(text, { languageId, level })
  );

  // Tool 2: read a workspace file and return an optimized version of it.
  server.registerTool(
    'read_file_optimized',
    {
      title: 'Read File (Optimized)',
      description:
        'PREFERRED way to read workspace files: use this INSTEAD OF the built-in ' +
        'file read tool whenever you need a file\'s contents. Returns a ' +
        'token-optimized version of the file (known-language comments and ' +
        'redundant whitespace pruned; Markdown formatting is preserved; ' +
        'secrets, IP/MAC addresses and e-mails masked), so it uses fewer tokens ' +
        'and keeps sensitive data out of context. Fall back to the built-in ' +
        'reader only if this tool returns an error or you need exact original ' +
        'formatting/line numbers to make an edit.',
      inputSchema: {
        path: z
          .string()
          .describe('Workspace-relative or absolute path inside the workspace root.'),
        level: levelSchema
      },
      annotations: { readOnlyHint: true }
    },
    async ({ path, level }) => {
      let absolutePath: string;
      let rawText: string;
      try {
        absolutePath = resolveWithinWorkspace(path);
        rawText = await fs.readFile(absolutePath, 'utf8');
      } catch (err) {
        return errorResult((err as Error).message);
      }
      return optimizedReply(rawText, { languageId: languageIdFromPath(absolutePath), level });
    }
  );

  // Tool 3: report cumulative session savings.
  server.registerTool(
    'get_token_stats',
    {
      title: 'Get Token Stats',
      description:
        'Return cumulative payload savings and net token/credit changes after including complete tool reply text and its summary.',
      inputSchema: {},
      annotations: { readOnlyHint: true }
    },
    async () => {
      if (!STATS_FILE) {
        return textResult('No stats file configured.');
      }
      const stats = await readStats(STATS_FILE, INPUT_PRICE_PER_MILLION_USD);
      return textResult(formatToolStatsReport(stats, INPUT_PRICE_PER_MILLION_USD));
    }
  );

  return server;
}

async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  // Surface fatal startup errors on stderr (visible in the MCP server output log).
  process.stderr.write(`[ai-token-optimizer] fatal: ${(err as Error).stack ?? err}\n`);
  process.exit(1);
});

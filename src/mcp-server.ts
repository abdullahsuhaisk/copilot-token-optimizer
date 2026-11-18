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
import { optimize, type OptimizeResult } from './optimizer.js';
import {
  countTokens,
  estimateSavedAICredits,
  measureSavings,
  recordSavings,
  readStats
} from './telemetry.js';
import { totalRedactions, type RedactionCounts } from './redactor.js';

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
 * Persists a savings measurement when a stats file is configured. Failures are
 * swallowed so telemetry never breaks a tool call.
 */
async function persist(
  rawText: string,
  result: OptimizeResult,
  responseText: string
): Promise<void> {
  // Never log the raw payload: it may contain the secrets we just masked.
  process.stderr.write(`[ai-token-optimizer] OPTIMIZED:\n${result.optimized}\n===\n`);

  if (!STATS_FILE) {
    return;
  }
  try {
    await recordSavings(
      STATS_FILE,
      {
        ...measureSavings(rawText, result.optimized),
        responseTokens: countTokens(responseText)
      },
      result.redactions,
      INPUT_PRICE_PER_MILLION_USD
    );
  } catch {
    // Telemetry is best-effort; ignore write errors.
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

/** Builds a one-line, human-readable savings summary for tool output. */
function savingsLine(rawText: string, result: OptimizeResult): string {
  const s = measureSavings(rawText, result.optimized);
  const tokenChange =
    s.savedTokens >= 0
      ? `saved ${s.savedTokens}, ${s.savedPct.toFixed(1)}%`
      : `added ${Math.abs(s.savedTokens)}, ${s.savedPct.toFixed(1)}%`;
  return (
    `Payload tokens: ${s.rawTokens} -> ${s.optimizedTokens} (${tokenChange})` +
    ` | Payload AI credit change (est.): ${formatAICreditChange(estimateSavedAICredits(s.savedTokens, INPUT_PRICE_PER_MILLION_USD))}` +
    ` ($${INPUT_PRICE_PER_MILLION_USD}/1M input tokens)` +
    ` | ${redactionLine(result.redactions)}`
  );
}

function toolResponse(rawText: string, result: OptimizeResult): string {
  return `${savingsLine(rawText, result)}\n${result.optimized}`;
}

function readInputPricePerMillionUsd(): number {
  const raw = process.env.AI_CREDIT_INPUT_PRICE_PER_MILLION_USD;
  const price = raw === undefined ? 1 : Number(raw);
  if (!Number.isFinite(price) || price < 0) {
    throw new Error('AI_CREDIT_INPUT_PRICE_PER_MILLION_USD must be a non-negative number.');
  }
  return price;
}

function formatAICredits(count: number): string {
  return String(Number(count.toFixed(6)));
}

function formatAICreditChange(count: number): string {
  return count >= 0
    ? `~${formatAICredits(count)} saved`
    : `~${formatAICredits(Math.abs(count))} added`;
}

/** Formats redaction counts, e.g. "Redacted: 3 (secrets 1, IPv4 2, IPv6 0, MAC 0, e-mail 0)". */
function redactionLine(r: RedactionCounts): string {
  return (
    `Redacted: ${totalRedactions(r)} (secrets ${r.secrets}, IPv4 ${r.ipv4}, ` +
    `IPv6 ${r.ipv6}, MAC ${r.mac}, e-mail ${r.email})`
  );
}

function createServer(): McpServer {
  const server = new McpServer({
    name: 'ai-token-optimizer',
    version: '0.0.3'
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
    async ({ text, languageId, level }) => {
      const result = optimize(text, { languageId, level });
      const response = toolResponse(text, result);
      await persist(text, result, response);
      return {
        content: [{ type: 'text', text: response }]
      };
    }
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
      let absolute: string;
      try {
        absolute = resolveWithinWorkspace(path);
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text', text: (err as Error).message }]
        };
      }

      const raw = await fs.readFile(absolute, 'utf8');
      const languageId = inferLanguageId(absolute);
      const result = optimize(raw, { languageId, level });
      const response = toolResponse(raw, result);
      await persist(raw, result, response);
      return {
        content: [{ type: 'text', text: response }]
      };
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
        return {
          content: [{ type: 'text', text: 'No stats file configured.' }]
        };
      }
      const stats = await readStats(STATS_FILE, INPUT_PRICE_PER_MILLION_USD);
      const pct =
        stats.totalRawTokens === 0
          ? 0
          : (stats.totalSavedTokens / stats.totalRawTokens) * 100;
      const summary =
        `Calls: ${stats.calls}\n` +
        `Payload raw tokens: ${stats.totalRawTokens}\n` +
        `Optimized payload tokens: ${stats.totalOptimizedTokens}\n` +
        `Payload net token change: ${formatNetChange(stats.totalSavedTokens)} (${pct.toFixed(1)}%)\n` +
        `Payload AI credit change (est.): ${formatAICreditChange(stats.totalEstimatedSavedAICredits)}\n` +
        `Complete reply measurements: ${stats.responseCalls} calls\n` +
        `Measured input tokens: ${stats.totalResponseInputTokens}\n` +
        `Returned text tokens (including summary): ${stats.totalResponseTokens}\n` +
        `Net tokens after summary: ${formatNetChange(stats.totalNetSavedTokens)}\n` +
        `Net AI credit change (est.): ${formatAICreditChange(stats.totalEstimatedNetSavedAICredits)}\n` +
        `Current estimate rate: $${INPUT_PRICE_PER_MILLION_USD} per 1M input tokens\n` +
        'Estimate only; actual Copilot usage depends on model pricing and cached tokens.\n' +
        redactionLine(stats.redactions);
      return { content: [{ type: 'text', text: summary }] };
    }
  );

  return server;
}

function formatNetChange(tokens: number): string {
  return tokens >= 0
    ? `${tokens} saved`
    : `${Math.abs(tokens)} added`;
}

/** Maps a file extension to a VS Code-style languageId for comment handling. */
function inferLanguageId(filePath: string): string | undefined {
  const ext = filePath.slice(filePath.lastIndexOf('.') + 1).toLowerCase();
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescriptreact',
    js: 'javascript',
    jsx: 'javascriptreact',
    py: 'python',
    rb: 'ruby',
    go: 'go',
    rs: 'rust',
    java: 'java',
    c: 'c',
    cpp: 'cpp',
    cs: 'csharp',
    php: 'php',
    sh: 'shellscript',
    md: 'markdown',
    mdx: 'mdx',
    txt: 'plaintext',
    log: 'log',
    yml: 'yaml',
    yaml: 'yaml'
  };
  return map[ext];
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

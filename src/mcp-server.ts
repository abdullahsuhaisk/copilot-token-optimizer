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
import { optimize } from './optimizer.js';
import { measureSavings, recordSavings, readStats } from './telemetry.js';

/** Absolute path to the shared stats JSON file, supplied by the extension. */
const STATS_FILE = process.env.STATS_FILE;

/**
 * Workspace root the file-reading tool is confined to. Supplied by the
 * extension. When unset, file reads are disabled for safety.
 */
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT;

const levelSchema = z
  .enum(['conservative', 'aggressive'])
  .optional()
  .describe('Pruning aggressiveness. Defaults to conservative (no semantic change).');

/**
 * Persists a savings measurement when a stats file is configured. Failures are
 * swallowed so telemetry never breaks a tool call.
 */
async function persist(rawText: string, optimizedText: string): Promise<void> {
    process.stderr.write(
    `[ai-token-optimizer] RAW:\n${rawText}\n---\nOPTIMIZED:\n${optimizedText}\n===\n`
  );

  if (!STATS_FILE) {
    return;
  }
  try {
    await recordSavings(STATS_FILE, measureSavings(rawText, optimizedText));
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
function savingsLine(rawText: string, optimizedText: string): string {
  const s = measureSavings(rawText, optimizedText);
  return `Tokens: ${s.rawTokens} -> ${s.optimizedTokens} (saved ${s.savedTokens}, ${s.savedPct.toFixed(1)}%)`;
}

function createServer(): McpServer {
  const server = new McpServer({
    name: 'ai-token-optimizer',
    version: '0.0.1'
  });

  // Tool 1: optimize an arbitrary text/code payload.
  server.registerTool(
    'optimize_context',
    {
      title: 'Optimize Context',
      description:
        'Prune and compress a text or code payload (strip comments, collapse ' +
        'whitespace, fold repeated lines) so it consumes fewer tokens. Returns ' +
        'the optimized text plus a token-savings summary.',
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
      await persist(text, result.optimized);
      return {
        content: [
          { type: 'text', text: savingsLine(text, result.optimized) },
          { type: 'text', text: result.optimized }
        ]
      };
    }
  );

  // Tool 2: read a workspace file and return an optimized version of it.
  server.registerTool(
    'read_file_optimized',
    {
      title: 'Read File (Optimized)',
      description:
        'Read a file from the workspace and return a token-optimized version of ' +
        'its contents instead of the raw file, reducing context usage.',
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
      await persist(raw, result.optimized);
      return {
        content: [
          { type: 'text', text: savingsLine(raw, result.optimized) },
          { type: 'text', text: result.optimized }
        ]
      };
    }
  );

  // Tool 3: report cumulative session savings.
  server.registerTool(
    'get_token_stats',
    {
      title: 'Get Token Stats',
      description: 'Return cumulative token-savings statistics for this session.',
      inputSchema: {},
      annotations: { readOnlyHint: true }
    },
    async () => {
      if (!STATS_FILE) {
        return {
          content: [{ type: 'text', text: 'No stats file configured.' }]
        };
      }
      const stats = await readStats(STATS_FILE);
      const pct =
        stats.totalRawTokens === 0
          ? 0
          : (stats.totalSavedTokens / stats.totalRawTokens) * 100;
      const summary =
        `Calls: ${stats.calls}\n` +
        `Raw tokens: ${stats.totalRawTokens}\n` +
        `Optimized tokens: ${stats.totalOptimizedTokens}\n` +
        `Saved tokens: ${stats.totalSavedTokens} (${pct.toFixed(1)}%)`;
      return { content: [{ type: 'text', text: summary }] };
    }
  );

  return server;
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

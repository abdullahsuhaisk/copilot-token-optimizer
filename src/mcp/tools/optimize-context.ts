import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerConfig } from '../config.js';
import { levelSchema, optimizedReply } from './shared.js';

/** Tool 1: optimize an arbitrary text or code payload. */
export function registerOptimizeContext(server: McpServer, config: ServerConfig): void {
  server.registerTool(
    'optimize_context',
    {
      title: 'Optimize Context',
      description:
        'Use this to shrink any large text or code payload (logs, terminal ' +
        'output, pasted code, API responses) before reasoning over it. Removes ' +
        'whole-line comments (only for known languages) and redundant blank ' +
        'lines; for languageId "log" or "plaintext" it also folds repeated ' +
        'lines. Markdown is preserved; aggressive space folding is limited to ' +
        'explicit plaintext. It masks secrets, IP/MAC addresses and e-mails. ' +
        'Returns the optimized text, preceded by a one-line token-savings and ' +
        'redaction summary when anything changed.',
      inputSchema: {
        text: z.string().describe('The raw text or code to optimize.'),
        languageId: z
          .string()
          .optional()
          .describe(
            'VS Code languageId (e.g. typescript, python) for comment syntax. ' +
              'Pass "log" for logs and terminal output, "plaintext" for prose.'
          ),
        level: levelSchema
      },
      annotations: { readOnlyHint: true }
    },
    async ({ text, languageId, level }) => optimizedReply(config, text, { languageId, level })
  );
}

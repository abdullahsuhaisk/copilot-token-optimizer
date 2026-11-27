import { promises as fs } from 'node:fs';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { languageIdFromPath } from '../../core/languages.js';
import { resolveWithinWorkspace } from '../../core/workspace-path.js';
import type { ServerConfig } from '../config.js';
import { errorMessage } from '../diagnostics.js';
import { errorResult, levelSchema, optimizedReply } from './shared.js';

/** Tool 2: read a workspace file and return an optimized version of it. */
export function registerReadFileOptimized(server: McpServer, config: ServerConfig): void {
  server.registerTool(
    'read_file_optimized',
    {
      title: 'Read File (Optimized)',
      description:
        'PREFERRED way to read workspace files: use this INSTEAD OF the built-in ' +
        "file read tool whenever you need a file's contents. Returns a " +
        'token-optimized version of the file (whole-line comments of known ' +
        'languages and redundant whitespace pruned; Markdown formatting is ' +
        'preserved; secrets, IP/MAC addresses and e-mails masked), so it uses ' +
        'fewer tokens and keeps sensitive data out of context. Fall back to the ' +
        'built-in reader only if this tool returns an error or you need exact ' +
        'original formatting/line numbers to make an edit.',
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
        absolutePath = await resolveWithinWorkspace(config.workspaceRoot, path);
        rawText = await fs.readFile(absolutePath, 'utf8');
      } catch (err) {
        return errorResult(errorMessage(err));
      }
      return optimizedReply(config, rawText, {
        languageId: languageIdFromPath(absolutePath),
        level
      });
    }
  );
}

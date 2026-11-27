import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { formatToolStatsReport } from '../../core/format/tool-reply.js';
import { readStats } from '../../core/stats-store.js';
import type { ServerConfig } from '../config.js';
import { textResult } from './shared.js';

/** Tool 3: report cumulative savings. */
export function registerGetTokenStats(server: McpServer, config: ServerConfig): void {
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
      if (!config.statsFile) {
        return textResult('No stats file configured.');
      }
      const stats = await readStats(config.statsFile, config.inputPricePerMillionUsd);
      return textResult(formatToolStatsReport(stats, config.inputPricePerMillionUsd));
    }
  );
}

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerConfig } from './config.js';
import { registerGetTokenStats } from './tools/get-token-stats.js';
import { registerOptimizeContext } from './tools/optimize-context.js';
import { registerReadFileOptimized } from './tools/read-file-optimized.js';

/** Builds the MCP server with its three tools. It is not connected to a transport yet. */
export function createServer(config: ServerConfig): McpServer {
  const server = new McpServer({
    name: 'ai-token-optimizer',
    version: config.version
  });

  registerOptimizeContext(server, config);
  registerReadFileOptimized(server, config);
  registerGetTokenStats(server, config);

  return server;
}

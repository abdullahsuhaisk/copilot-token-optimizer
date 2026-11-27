/**
 * Diagnostics for the MCP server process. stdout carries the MCP protocol, so
 * everything human-readable goes to stderr, where VS Code shows it in the
 * server's output log.
 */

export function log(message: string): void {
  process.stderr.write(`[ai-token-optimizer] ${message}\n`);
}

/** The message of a caught value, which is not necessarily an `Error`. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

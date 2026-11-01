/**
 * Enterprise AI Token Optimizer — VS Code extension entry point.
 *
 * Responsibilities:
 *  1. Register an MCP server definition provider that launches the bundled
 *     stdio MCP server (`out/mcp-server.js`) with a per-session stats file and
 *     workspace root passed via environment variables.
 *  2. Render real-time "tokens saved" telemetry in the status bar by watching
 *     the shared stats file the server writes to.
 *  3. Provide a command to display a detailed savings breakdown.
 */

import * as vscode from 'vscode';
import { join } from 'node:path';
import { readStats, type SessionStats } from './telemetry';
import { totalRedactions } from './redactor';

const PROVIDER_ID = 'aiTokenOptimizer.provider';
const SHOW_STATS_COMMAND = 'aiTokenOptimizer.showStats';

let statusBarItem: vscode.StatusBarItem;
let outputChannel: vscode.OutputChannel;
let statsFilePath: string;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  outputChannel = vscode.window.createOutputChannel('AI Token Optimizer');
  context.subscriptions.push(outputChannel);

  // Per-session stats file lives in the extension's global storage.
  await vscode.workspace.fs.createDirectory(context.globalStorageUri);
  statsFilePath = join(context.globalStorageUri.fsPath, 'stats.json');

  // Status bar telemetry.
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = SHOW_STATS_COMMAND;
  statusBarItem.tooltip = 'AI Token Optimizer — click for savings breakdown';
  context.subscriptions.push(statusBarItem);
  await refreshStatusBar();
  statusBarItem.show();

  // Re-render the status bar whenever the server updates the stats file.
  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(context.globalStorageUri, 'stats.json')
  );
  watcher.onDidCreate(refreshStatusBar);
  watcher.onDidChange(refreshStatusBar);
  context.subscriptions.push(watcher);

  // Command: show detailed savings breakdown.
  context.subscriptions.push(
    vscode.commands.registerCommand(SHOW_STATS_COMMAND, showStats)
  );

  // Register the MCP server definition provider.
  context.subscriptions.push(
    vscode.lm.registerMcpServerDefinitionProvider(PROVIDER_ID, {
      provideMcpServerDefinitions: () => [createServerDefinition(context)]
    })
  );

  outputChannel.appendLine('AI Token Optimizer activated.');
}

export function deactivate(): void {
  // Disposables are cleaned up via context.subscriptions.
}

/** Builds the stdio MCP server definition, wiring env vars for the server. */
function createServerDefinition(
  context: vscode.ExtensionContext
): vscode.McpStdioServerDefinition {
  const serverScript = vscode.Uri.joinPath(context.extensionUri, 'out', 'mcp-server.js').fsPath;
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';

  return new vscode.McpStdioServerDefinition(
    'AI Token Optimizer',
    'node',
    [serverScript],
    {
      STATS_FILE: statsFilePath,
      WORKSPACE_ROOT: workspaceRoot
    }
  );
}

/** Reads current stats and updates the status bar label. */
async function refreshStatusBar(): Promise<void> {
  const stats = await readStats(statsFilePath);
  statusBarItem.text =
    `$(zap) Saved ${formatTokens(stats.totalSavedTokens)} tokens · ` +
    `$(shield) ${totalRedactions(stats.redactions)} redacted`;
}

/** Opens the output channel with a detailed savings breakdown. */
async function showStats(): Promise<void> {
  const stats = await readStats(statsFilePath);
  const pct = savedPct(stats);

  outputChannel.clear();
  outputChannel.appendLine('=== AI Token Optimizer — Session Savings ===');
  outputChannel.appendLine(`Optimization calls : ${stats.calls}`);
  outputChannel.appendLine(`Raw tokens         : ${stats.totalRawTokens}`);
  outputChannel.appendLine(`Optimized tokens   : ${stats.totalOptimizedTokens}`);
  outputChannel.appendLine(
    `Tokens saved       : ${stats.totalSavedTokens} (${pct.toFixed(1)}%)`
  );
  const r = stats.redactions;
  outputChannel.appendLine(`Redacted (total)   : ${totalRedactions(r)}`);
  outputChannel.appendLine(`  Secrets / keys   : ${r.secrets}`);
  outputChannel.appendLine(`  IPv4 addresses   : ${r.ipv4}`);
  outputChannel.appendLine(`  IPv6 addresses   : ${r.ipv6}`);
  outputChannel.appendLine(`  MAC addresses    : ${r.mac}`);
  outputChannel.appendLine(`  E-mail addresses : ${r.email}`);
  outputChannel.show(true);
}

/** Computes the overall saved percentage for a stats accumulator. */
function savedPct(stats: SessionStats): number {
  return stats.totalRawTokens === 0
    ? 0
    : (stats.totalSavedTokens / stats.totalRawTokens) * 100;
}

/** Formats a token count compactly (e.g. 1234 -> "1.2k"). */
function formatTokens(count: number): string {
  if (count < 1000) {
    return String(count);
  }
  // return `${(count / 100000).toFixed(1)}k`;
  return `${count}`;
}

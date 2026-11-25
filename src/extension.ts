/**
 * Enterprise AI Token Optimizer — VS Code extension entry point.
 *
 * Responsibilities:
 *  1. Register an MCP server definition provider that launches the bundled
 *     stdio MCP server (`out/mcp-server.js`) with a shared stats file and
 *     workspace root passed via environment variables.
 *  2. Render real-time "tokens saved" telemetry in the status bar by watching
 *     the shared stats file the server writes to.
 *  3. Provide a command to display a detailed savings breakdown.
 */

import * as vscode from 'vscode';
import { join } from 'node:path';
import { readStats, type SessionStats } from './core/telemetry';
import { formatSavingsReport, formatStatusBarText } from './core/format';

const PROVIDER_ID = 'aiTokenOptimizer.provider';
const SHOW_STATS_COMMAND = 'aiTokenOptimizer.showStats';
const CONFIGURATION_SECTION = 'aiTokenOptimizer';
const INPUT_PRICE_SETTING = 'aiCreditInputPricePerMillionUsd';
const DEFAULT_INPUT_PRICE_PER_MILLION_USD = 1;

type InputPriceProvider = () => number;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const outputChannel = vscode.window.createOutputChannel('AI Token Optimizer');
  // Global storage is shared by all windows, so the status bar shows the
  // cumulative total across every workspace.
  const statsFilePath = join(context.globalStorageUri.fsPath, 'stats.json');
  const inputPrice = createInputPriceProvider();
  const statsView = new StatsView(statsFilePath, inputPrice, outputChannel);

  context.subscriptions.push(statsView);
  await vscode.workspace.fs.createDirectory(context.globalStorageUri);
  await statsView.refresh();
  statsView.show();

  registerStatsWatcher(context, () => statsView.refresh());
  context.subscriptions.push(
    // Other windows may have updated the total; resync when this one is focused.
    vscode.window.onDidChangeWindowState((state) => {
      if (state.focused) {
        void statsView.refresh();
      }
    }),
    vscode.commands.registerCommand(SHOW_STATS_COMMAND, () => statsView.showDetails()),
    vscode.lm.registerMcpServerDefinitionProvider(PROVIDER_ID, {
      provideMcpServerDefinitions: () => [
        createServerDefinition(context, statsFilePath, inputPrice)
      ]
    })
  );

  outputChannel.appendLine('AI Token Optimizer activated.');
}

export function createServerDefinition(
  context: vscode.ExtensionContext,
  statsFilePath: string,
  inputPrice: InputPriceProvider
): vscode.McpStdioServerDefinition {
  const serverScript = vscode.Uri.joinPath(context.extensionUri, 'out', 'mcp-server.js').fsPath;
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';

  return new vscode.McpStdioServerDefinition(
    'AI Token Optimizer',
    // VS Code'un gömülü Node'u; kullanıcının PATH'ine bağımlı değil.
    process.execPath,
    [serverScript],
    {
      ELECTRON_RUN_AS_NODE: '1',
      STATS_FILE: statsFilePath,
      WORKSPACE_ROOT: workspaceRoot,
      AI_CREDIT_INPUT_PRICE_PER_MILLION_USD: String(inputPrice())
    }
  );
}

class StatsView implements vscode.Disposable {
  private readonly statusBarItem: vscode.StatusBarItem;

  constructor(
    private readonly statsFilePath: string,
    private readonly inputPrice: InputPriceProvider,
    private readonly outputChannel: vscode.OutputChannel
  ) {
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.statusBarItem.command = SHOW_STATS_COMMAND;
    this.statusBarItem.tooltip =
      'Payload: all calls, excluding reply summaries. Reply: measured complete replies only. ' +
      'Totals overlap; do not add them. Click for savings breakdown.';
  }

  async refresh(): Promise<void> {
    const stats = await this.loadStats();
    this.statusBarItem.text = formatStatusBarText(stats);
  }

  show(): void {
    this.statusBarItem.show();
  }

  async showDetails(): Promise<void> {
    const stats = await this.loadStats();
    this.outputChannel.clear();
    for (const line of formatSavingsReport(stats, this.inputPrice())) {
      this.outputChannel.appendLine(line);
    }
    this.outputChannel.show(true);
  }

  dispose(): void {
    this.statusBarItem.dispose();
    this.outputChannel.dispose();
  }

  private loadStats(): Promise<SessionStats> {
    return readStats(this.statsFilePath, this.inputPrice());
  }
}

function registerStatsWatcher(
  context: vscode.ExtensionContext,
  refresh: () => Promise<void>
): void {
  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(context.globalStorageUri, 'stats.json')
  );
  context.subscriptions.push(
    watcher,
    watcher.onDidCreate(() => refresh()),
    watcher.onDidChange(() => refresh())
  );
}

function createInputPriceProvider(): InputPriceProvider {
  let hasWarnedAboutInvalidPrice = false;

  return () => {
    const price = vscode.workspace
      .getConfiguration(CONFIGURATION_SECTION)
      .get<number>(INPUT_PRICE_SETTING, DEFAULT_INPUT_PRICE_PER_MILLION_USD);

    if (!Number.isFinite(price) || price < 0) {
      if (!hasWarnedAboutInvalidPrice) {
        hasWarnedAboutInvalidPrice = true;
        void vscode.window.showWarningMessage(
          `${INPUT_PRICE_SETTING} must be a non-negative number. ` +
          `Using the default rate of $${DEFAULT_INPUT_PRICE_PER_MILLION_USD} per 1M input tokens.`
        );
      }
      return DEFAULT_INPUT_PRICE_PER_MILLION_USD;
    }

    hasWarnedAboutInvalidPrice = false;
    return price;
  };
}

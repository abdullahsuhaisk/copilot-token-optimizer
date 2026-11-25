import { describe, it, expect, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { emptyStats, recordSavings } from '../src/core/telemetry';

vi.mock('vscode', () => {
  class McpStdioServerDefinition {
    constructor(
      public label: string,
      public command: string,
      public args: string[],
      public env: Record<string, string | number | null>
    ) {}
  }
  const disposable = () => ({ dispose: vi.fn() });
  return {
    McpStdioServerDefinition,
    RelativePattern: class {},
    Uri: {
      file: (fsPath: string) => ({ fsPath }),
      joinPath: (base: { fsPath: string }, ...p: string[]) => ({ fsPath: [base.fsPath, ...p].join('/') })
    },
    workspace: {
      workspaceFolders: [{ uri: { fsPath: '/ws' } }],
      getConfiguration: vi.fn(() => ({
        get: (_key: string, defaultValue: number) => defaultValue
      })),
      fs: { createDirectory: vi.fn().mockResolvedValue(undefined) },
      createFileSystemWatcher: vi.fn(() => ({
        onDidCreate: vi.fn(disposable),
        onDidChange: vi.fn(disposable),
        ...disposable()
      }))
    },
    window: {
      createOutputChannel: vi.fn(() => ({
        appendLine: vi.fn(),
        clear: vi.fn(),
        show: vi.fn(),
        ...disposable()
      })),
      createStatusBarItem: vi.fn(() => ({ text: '', show: vi.fn(), ...disposable() })),
      onDidChangeWindowState: vi.fn(disposable),
      showWarningMessage: vi.fn()
    },
    lm: { registerMcpServerDefinitionProvider: vi.fn(disposable) },
    commands: { registerCommand: vi.fn(disposable) },
    StatusBarAlignment: { Right: 2 }
  };
});

import { activate, createServerDefinition } from '../src/extension';

describe('createServerDefinition', () => {
  const def = createServerDefinition({
    extensionUri: { fsPath: '/ext' }
  } as never, '/storage/stats.json', () => 1);

  it('uses the current runtime instead of PATH lookup', () => {
    expect(def.command).toBe(process.execPath);
  });

  it('runs the runtime as plain Node with string env values', () => {
    expect(def.env.ELECTRON_RUN_AS_NODE).toBe('1');
    expect(def.env.WORKSPACE_ROOT).toBe('/ws');
    expect(def.env.STATS_FILE).toBe('/storage/stats.json');
    expect(def.env.AI_CREDIT_INPUT_PRICE_PER_MILLION_USD).toBe('1');
    expect(typeof def.env.ELECTRON_RUN_AS_NODE).toBe('string');
    expect(typeof def.env.WORKSPACE_ROOT).toBe('string');
  });
});

async function startExtension(directory: string) {
  await activate({
    extensionUri: vscode.Uri.file('/ext'),
    globalStorageUri: vscode.Uri.file(directory),
    subscriptions: []
  } as vscode.ExtensionContext);

  const statusBar = vi.mocked(vscode.window.createStatusBarItem).mock.results.at(-1)?.value;
  const watcher = vi.mocked(vscode.workspace.createFileSystemWatcher).mock.results.at(-1)?.value;
  if (!statusBar || !watcher) {
    throw new Error('Extension did not create its status bar and stats watcher.');
  }
  return { statusBar, watcher };
}

describe('status bar savings', () => {
  it('warns and uses the default price when the configured rate is invalid', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ai-token-optimizer-'));
    try {
      vi.mocked(vscode.workspace.getConfiguration).mockReturnValueOnce({
        get: () => -1
      } as never);

      await startExtension(directory);

      expect(vscode.window.showWarningMessage).toHaveBeenCalledOnce();
      const provider = vi.mocked(vscode.lm.registerMcpServerDefinitionProvider)
        .mock.calls.at(-1)?.[1];
      if (!provider) {
        throw new Error('MCP server definition provider was not registered.');
      }
      const [definition] = provider.provideMcpServerDefinitions();
      expect(definition.env.AI_CREDIT_INPUT_PRICE_PER_MILLION_USD).toBe('1');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('keeps older payload totals visible before and after the first measured reply', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ai-token-optimizer-'));
    const filePath = join(directory, 'stats.json');
    try {
      await writeFile(filePath, JSON.stringify({
        calls: 2,
        totalRawTokens: 100,
        totalOptimizedTokens: 75,
        totalSavedTokens: 25,
        totalEstimatedSavedAICredits: 0.0025,
        redactions: { ...emptyStats().redactions, secrets: 2 }
      }));

      const { statusBar, watcher } = await startExtension(directory);
      expect(statusBar.text).toBe(
        '$(zap) Payload 25 saved tokens · ~0.0025 AI credits · ' +
        'Reply not measured · $(shield) 2 redacted'
      );

      await recordSavings(filePath, {
        rawTokens: 100,
        optimizedTokens: 50,
        savedTokens: 50,
        savedPct: 50,
        responseTokens: 65
      });
      const onChange = vi.mocked(watcher.onDidChange).mock.calls[0]?.[0];
      if (!onChange) {
        throw new Error('Stats change listener was not registered.');
      }
      await onChange(vscode.Uri.file(filePath));

      expect(statusBar.text).toBe(
        '$(zap) Payload 75 saved tokens · ~0.0075 AI credits · ' +
        'Reply 35 saved tokens · ~0.0035 AI credits · $(shield) 2 redacted'
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('shows only measured reply totals for new stats, including token growth', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ai-token-optimizer-'));
    const filePath = join(directory, 'stats.json');
    try {
      const { statusBar, watcher } = await startExtension(directory);
      expect(statusBar.text).toBe('$(zap) Reply not measured · $(shield) 0 redacted');

      await recordSavings(filePath, {
        rawTokens: 100,
        optimizedTokens: 95,
        savedTokens: 5,
        savedPct: 5,
        responseTokens: 110
      });
      const onCreate = vi.mocked(watcher.onDidCreate).mock.calls[0]?.[0];
      if (!onCreate) {
        throw new Error('Stats creation listener was not registered.');
      }
      await onCreate(vscode.Uri.file(filePath));

      expect(statusBar.text).toBe(
        '$(zap) Reply 10 added tokens · ~0.001 AI credits added · $(shield) 0 redacted'
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

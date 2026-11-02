import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => {
  class McpStdioServerDefinition {
    constructor(
      public label: string,
      public command: string,
      public args: string[],
      public env: Record<string, string | number | null>
    ) {}
  }
  return {
    McpStdioServerDefinition,
    Uri: { joinPath: (base: { fsPath: string }, ...p: string[]) => ({ fsPath: [base.fsPath, ...p].join('/') }) },
    workspace: { workspaceFolders: [{ uri: { fsPath: '/ws' } }] },
    window: {},
    lm: {},
    commands: {},
    StatusBarAlignment: { Right: 2 }
  };
});

import { createServerDefinition } from './extension';

describe('createServerDefinition', () => {
  const def = createServerDefinition({
    extensionUri: { fsPath: '/ext' }
  } as never);

  it('uses the current runtime instead of PATH lookup', () => {
    expect(def.command).toBe(process.execPath);
  });

  it('runs the runtime as plain Node with string env values', () => {
    expect(def.env.ELECTRON_RUN_AS_NODE).toBe('1');
    expect(def.env.WORKSPACE_ROOT).toBe('/ws');
    expect(typeof def.env.ELECTRON_RUN_AS_NODE).toBe('string');
    expect(typeof def.env.WORKSPACE_ROOT).toBe('string');
  });
});

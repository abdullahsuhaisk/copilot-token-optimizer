import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { readStats } from '../src/core/stats-store';
import { loadServerConfig, readPackageVersion, type ServerConfig } from '../src/mcp/config';
import { createServer } from '../src/mcp/server';

async function connect(config: ServerConfig): Promise<Client> {
  const server = createServer(config);
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

async function callTool(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  const [first] = result.content as Array<{ type: string; text: string }>;
  return { isError: result.isError === true, text: first.text };
}

describe('MCP server', () => {
  let base: string;
  let workspace: string;
  let config: ServerConfig;
  let client: Client;

  beforeEach(async () => {
    // The server logs to stderr; keep that out of the test report.
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    base = await realpath(await mkdtemp(join(tmpdir(), 'ai-token-optimizer-')));
    workspace = join(base, 'workspace');
    await mkdir(workspace);
    config = {
      version: '0.0.0',
      statsFile: join(base, 'stats.json'),
      workspaceRoot: workspace,
      inputPricePerMillionUsd: 1
    };
    client = await connect(config);
  });

  afterEach(async () => {
    await client.close();
    await rm(base, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('exposes three read-only tools', async () => {
    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'get_token_stats',
      'optimize_context',
      'read_file_optimized'
    ]);
    expect(tools.every((tool) => tool.annotations?.readOnlyHint === true)).toBe(true);
  });

  it('optimizes a workspace file and puts a one-line summary in front', async () => {
    await writeFile(
      join(workspace, 'app.ts'),
      '// header\nconst key = "AKIAIOSFODNN7EXAMPLE";\n\n\n\nrun();\n'
    );

    const { isError, text } = await callTool(client, 'read_file_optimized', { path: 'app.ts' });

    expect(isError).toBe(false);
    const [summary, ...body] = text.split('\n');
    expect(summary).toMatch(/^\[token-optimizer\] \d+->\d+ tokens \(.+\) \| redacted 1: secrets 1$/);
    expect(body.join('\n')).toBe('const key = "[REDACTED_SECRET]";\n\nrun();');
  });

  it('returns an unchanged payload as is, without a summary', async () => {
    const { text } = await callTool(client, 'optimize_context', { text: 'hello world' });
    expect(text).toBe('hello world');
  });

  it('folds repeated lines only when told the text is a log', async () => {
    const text = 'retry\nretry\nretry\ndone';

    expect((await callTool(client, 'optimize_context', { text })).text).toBe(text);
    expect((await callTool(client, 'optimize_context', { text, languageId: 'log' })).text).toContain(
      'retry  (x3)\ndone'
    );
  });

  it('refuses paths outside the workspace', async () => {
    await writeFile(join(base, 'outside.txt'), 'outside');

    for (const path of ['../outside.txt', join(base, 'outside.txt')]) {
      const { isError, text } = await callTool(client, 'read_file_optimized', { path });
      expect(isError).toBe(true);
      expect(text).toBe('File access blocked: path escapes the workspace root.');
    }
  });

  it.skipIf(process.platform === 'win32')('does not follow a symlink out of the workspace', async () => {
    await writeFile(join(base, 'outside.txt'), 'outside');
    await symlink(join(base, 'outside.txt'), join(workspace, 'link.txt'));

    const { isError, text } = await callTool(client, 'read_file_optimized', { path: 'link.txt' });

    expect(isError).toBe(true);
    expect(text).toContain('escapes the workspace root');
  });

  it('disables file reads when no workspace root is configured', async () => {
    const closed = await connect({ ...config, workspaceRoot: undefined });
    try {
      const { isError, text } = await callTool(closed, 'read_file_optimized', { path: 'app.ts' });
      expect(isError).toBe(true);
      expect(text).toContain('File reads are disabled');
    } finally {
      await closed.close();
    }
  });

  it('records every call and reports the totals through get_token_stats', async () => {
    await callTool(client, 'optimize_context', { text: '// note\nconst a = 1;', languageId: 'typescript' });
    await callTool(client, 'optimize_context', { text: 'hello world' });

    const stats = await readStats(config.statsFile as string);
    expect(stats.calls).toBe(2);
    expect(stats.responseCalls).toBe(2);

    const { text } = await callTool(client, 'get_token_stats');
    expect(text).toContain('Calls: 2');
  });

  it('says so when no stats file is configured', async () => {
    const quiet = await connect({ ...config, statsFile: undefined });
    try {
      expect((await callTool(quiet, 'get_token_stats')).text).toBe('No stats file configured.');
    } finally {
      await quiet.close();
    }
  });
});

describe('loadServerConfig', () => {
  it('reads the environment and treats empty values as unset', () => {
    expect(
      loadServerConfig(
        {
          STATS_FILE: '/s.json',
          WORKSPACE_ROOT: '/ws',
          AI_CREDIT_INPUT_PRICE_PER_MILLION_USD: '2.5'
        },
        '1.2.3'
      )
    ).toEqual({
      version: '1.2.3',
      statsFile: '/s.json',
      workspaceRoot: '/ws',
      inputPricePerMillionUsd: 2.5
    });

    expect(
      loadServerConfig(
        { STATS_FILE: '', WORKSPACE_ROOT: '', AI_CREDIT_INPUT_PRICE_PER_MILLION_USD: ' ' },
        '1.0.0'
      )
    ).toEqual({
      version: '1.0.0',
      statsFile: undefined,
      workspaceRoot: undefined,
      inputPricePerMillionUsd: 1
    });
  });

  it('rejects an input price that is not a non-negative number', () => {
    for (const price of ['-1', 'abc']) {
      expect(() =>
        loadServerConfig({ AI_CREDIT_INPUT_PRICE_PER_MILLION_USD: price }, '1.0.0')
      ).toThrow('non-negative');
    }
  });

  it("reports the extension's package version", () => {
    expect(readPackageVersion(join(process.cwd(), 'package.json'))).toMatch(/^\d+\.\d+\.\d+/);
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveWithinWorkspace } from '../src/core/workspace-path';

describe('resolveWithinWorkspace', () => {
  let base: string;
  let workspace: string;
  let outside: string;

  beforeEach(async () => {
    // tmpdir() is itself a symlink on macOS, so compare real paths throughout.
    base = await realpath(await mkdtemp(join(tmpdir(), 'ai-token-optimizer-')));
    workspace = join(base, 'workspace');
    outside = join(base, 'outside');
    await mkdir(workspace);
    await mkdir(outside);
    await writeFile(join(workspace, 'inside.txt'), 'inside');
    await writeFile(join(outside, 'secret.txt'), 'secret');
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it('returns the real path of a file inside the workspace, relative or absolute', async () => {
    const expected = join(workspace, 'inside.txt');
    expect(await resolveWithinWorkspace(workspace, 'inside.txt')).toBe(expected);
    expect(await resolveWithinWorkspace(workspace, expected)).toBe(expected);
  });

  it('rejects parent traversal and absolute paths elsewhere', async () => {
    await expect(resolveWithinWorkspace(workspace, '../outside/secret.txt')).rejects.toThrow(
      'escapes the workspace root'
    );
    await expect(resolveWithinWorkspace(workspace, join(outside, 'secret.txt'))).rejects.toThrow(
      'escapes the workspace root'
    );
  });

  it('does not reveal whether a file outside the workspace exists', async () => {
    await expect(resolveWithinWorkspace(workspace, '../outside/missing.txt')).rejects.toThrow(
      'escapes the workspace root'
    );
  });

  it('allows a folder whose name merely starts with two dots', async () => {
    await mkdir(join(workspace, '..hidden'));
    await writeFile(join(workspace, '..hidden', 'a.txt'), 'a');
    expect(await resolveWithinWorkspace(workspace, '..hidden/a.txt')).toBe(
      join(workspace, '..hidden', 'a.txt')
    );
  });

  it('refuses every path when no workspace root is configured', async () => {
    await expect(resolveWithinWorkspace(undefined, 'inside.txt')).rejects.toThrow(
      'File reads are disabled'
    );
  });

  // Creating symlinks needs elevated rights on Windows.
  describe.skipIf(process.platform === 'win32')('symlinks', () => {
    it('rejects a symlinked folder that leads outside the workspace', async () => {
      await symlink(outside, join(workspace, 'link-out'), 'dir');
      await expect(resolveWithinWorkspace(workspace, 'link-out/secret.txt')).rejects.toThrow(
        'escapes the workspace root'
      );
    });

    it('rejects a symlinked file that points outside the workspace', async () => {
      await symlink(join(outside, 'secret.txt'), join(workspace, 'secret-link.txt'));
      await expect(resolveWithinWorkspace(workspace, 'secret-link.txt')).rejects.toThrow(
        'escapes the workspace root'
      );
    });

    it('follows a symlink that stays inside the workspace', async () => {
      await symlink(join(workspace, 'inside.txt'), join(workspace, 'alias.txt'));
      expect(await resolveWithinWorkspace(workspace, 'alias.txt')).toBe(
        join(workspace, 'inside.txt')
      );
    });

    it('works when the workspace root itself is reached through a symlink', async () => {
      const rootLink = join(base, 'root-link');
      await symlink(workspace, rootLink, 'dir');
      expect(await resolveWithinWorkspace(rootLink, 'inside.txt')).toBe(
        join(workspace, 'inside.txt')
      );
    });
  });
});

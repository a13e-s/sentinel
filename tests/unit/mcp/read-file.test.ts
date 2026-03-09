import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createReadFileHandler } from '../../../mcp-server/src/tools/read-file.js';
import { createListDirectoryHandler } from '../../../mcp-server/src/tools/list-directory.js';
import { createSearchFilesHandler } from '../../../mcp-server/src/tools/search-files.js';

describe('repo path security', () => {
  let targetDir: string;

  beforeEach(() => {
    targetDir = join(tmpdir(), `sentinel-read-file-test-${Date.now()}`);
    mkdirSync(targetDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(targetDir, { recursive: true, force: true });
  });

  it('reads a normal in-repo file', async () => {
    writeFileSync(join(targetDir, 'notes.txt'), 'hello\nworld');

    const handler = createReadFileHandler(targetDir);
    const result = await handler({ file_path: 'notes.txt' });

    expect(result.isError).toBe(false);
    const response = JSON.parse(result.content[0]!.text);
    expect(response.content).toContain('hello');
  });

  it('rejects traversal outside the repository', async () => {
    const handler = createReadFileHandler(targetDir);
    const result = await handler({ file_path: '../../../etc/passwd' });

    expect(result.isError).toBe(true);
    const response = JSON.parse(result.content[0]!.text);
    expect(response.message).toContain('outside the repository');
  });

  it('rejects symlinked files even when they resolve inside the repository', async () => {
    writeFileSync(join(targetDir, 'real.txt'), 'safe');
    symlinkSync(join(targetDir, 'real.txt'), join(targetDir, 'alias.txt'));

    const handler = createReadFileHandler(targetDir);
    const result = await handler({ file_path: 'alias.txt' });

    expect(result.isError).toBe(true);
    const response = JSON.parse(result.content[0]!.text);
    expect(response.message).toContain('symbolic link');
  });

  it('does not traverse symlinked directories during list_directory', async () => {
    mkdirSync(join(targetDir, 'subdir'));
    writeFileSync(join(targetDir, 'subdir', 'real.txt'), 'real');
    symlinkSync(join(targetDir, 'subdir'), join(targetDir, 'linked-dir'));

    const handler = createListDirectoryHandler(targetDir);
    const result = await handler({ directory_path: '.', recursive: true });

    expect(result.isError).toBe(false);
    const response = JSON.parse(result.content[0]!.text);
    const names = response.entries.map((entry: { name: string }) => entry.name);
    expect(names).toContain('subdir/');
    expect(names).toContain('subdir/real.txt');
    expect(names).not.toContain('linked-dir/');
  });

  it('does not traverse symlinked directories during search_files', async () => {
    mkdirSync(join(targetDir, 'subdir'));
    writeFileSync(join(targetDir, 'subdir', 'real.txt'), 'needle');
    symlinkSync(join(targetDir, 'subdir'), join(targetDir, 'linked-dir'));

    const handler = createSearchFilesHandler(targetDir);
    const result = await handler({ pattern: 'needle', directory_path: '.', max_results: 10 });

    expect(result.isError).toBe(false);
    const response = JSON.parse(result.content[0]!.text);
    expect(response.matches).toEqual([
      { file: 'subdir/real.txt', line: 1, content: 'needle' },
    ]);
  });
});

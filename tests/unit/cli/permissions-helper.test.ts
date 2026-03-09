import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const HELPER_PATH = join(import.meta.dirname, '../../../scripts/permissions.sh');

describe('permissions helper', () => {
  const createdDirs: string[] = [];

  afterEach(() => {
    for (const dir of createdDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function createTempDir(): string {
    const dir = join(tmpdir(), `sentinel-permissions-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    createdDirs.push(dir);
    return dir;
  }

  function ensureDirWithHelper(dir: string, env: NodeJS.ProcessEnv = process.env): void {
    execFileSync(
      'bash',
      ['-lc', `. "${HELPER_PATH}"; ensure_shared_dir "$TARGET_DIR"`],
      {
        env: { ...env, TARGET_DIR: dir },
        stdio: 'pipe',
      },
    );
  }

  it('defaults shared directories to mode 0770', () => {
    const dir = createTempDir();

    ensureDirWithHelper(dir);

    expect(statSync(dir).mode & 0o777).toBe(0o770);
  });

  it('supports the legacy 0777 compatibility flag', () => {
    const dir = createTempDir();

    ensureDirWithHelper(dir, {
      ...process.env,
      SENTINEL_LEGACY_PERMISSIONS: 'true',
    });

    expect(statSync(dir).mode & 0o777).toBe(0o777);
  });

  it('tightens an existing directory while preserving writability for the current user', () => {
    const dir = createTempDir();
    mkdirSync(dir, { recursive: true, mode: 0o777 });

    ensureDirWithHelper(dir);

    expect(statSync(dir).mode & 0o777).toBe(0o770);

    const testFile = join(dir, 'probe.txt');
    writeFileSync(testFile, 'ok', 'utf-8');
    expect(statSync(testFile).size).toBe(2);
  });
});

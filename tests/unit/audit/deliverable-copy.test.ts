import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import { mkdirSync, rmSync, symlinkSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { copyDeliverablesToAudit } from '../../../src/audit/utils.js';
import type { SessionMetadata } from '../../../src/types/audit.js';

describe('copyDeliverablesToAudit', () => {
  let repoPath: string;
  let outputPath: string;
  let sessionMetadata: SessionMetadata;

  beforeEach(async () => {
    repoPath = join(tmpdir(), `sentinel-audit-repo-${Date.now()}`);
    outputPath = join(tmpdir(), `sentinel-audit-output-${Date.now()}`);

    mkdirSync(join(repoPath, 'deliverables'), { recursive: true });
    mkdirSync(outputPath, { recursive: true });

    sessionMetadata = {
      id: 'test-session',
      webUrl: 'https://example.com',
      outputPath,
    };

    await fs.mkdir(join(outputPath, 'test-session'), { recursive: true });
  });

  afterEach(() => {
    rmSync(repoPath, { recursive: true, force: true });
    rmSync(outputPath, { recursive: true, force: true });
  });

  it('copies normal deliverable files', async () => {
    writeFileSync(join(repoPath, 'deliverables', 'report.md'), '# report');

    await copyDeliverablesToAudit(sessionMetadata, repoPath);

    const copiedPath = join(outputPath, 'test-session', 'deliverables', 'report.md');
    expect(existsSync(copiedPath)).toBe(true);
    expect(readFileSync(copiedPath, 'utf-8')).toBe('# report');
  });

  it('skips symlinked deliverables', async () => {
    writeFileSync(join(repoPath, 'outside.txt'), 'secret');
    symlinkSync(
      join(repoPath, 'outside.txt'),
      join(repoPath, 'deliverables', 'link.md'),
    );

    await copyDeliverablesToAudit(sessionMetadata, repoPath);

    const copiedPath = join(outputPath, 'test-session', 'deliverables', 'link.md');
    expect(existsSync(copiedPath)).toBe(false);
  });

  it('skips a symlinked deliverables directory entirely', async () => {
    rmSync(join(repoPath, 'deliverables'), { recursive: true, force: true });
    mkdirSync(join(repoPath, 'outside-deliverables'));
    writeFileSync(join(repoPath, 'outside-deliverables', 'report.md'), '# external');
    symlinkSync(
      join(repoPath, 'outside-deliverables'),
      join(repoPath, 'deliverables'),
    );

    await copyDeliverablesToAudit(sessionMetadata, repoPath);

    const copiedPath = join(outputPath, 'test-session', 'deliverables', 'report.md');
    expect(existsSync(copiedPath)).toBe(false);
  });
});

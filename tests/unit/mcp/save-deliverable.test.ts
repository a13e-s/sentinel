import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, readFileSync, writeFileSync, symlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createSaveDeliverableHandler } from '../../../mcp-server/src/tools/save-deliverable.js';
import { DeliverableType } from '../../../mcp-server/src/types/deliverables.js';

describe('save_deliverable tool', () => {
  let targetDir: string;

  beforeEach(() => {
    targetDir = join(tmpdir(), `sentinel-test-${Date.now()}`);
    mkdirSync(targetDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(targetDir, { recursive: true, force: true });
  });

  it('saves a markdown deliverable with inline content', async () => {
    const handler = createSaveDeliverableHandler(targetDir);
    const result = await handler({
      deliverable_type: DeliverableType.CODE_ANALYSIS,
      content: '# Code Analysis\n\nFindings here.',
    });

    expect(result.isError).toBe(false);
    const response = JSON.parse(result.content[0]!.text);
    expect(response.status).toBe('success');
    expect(response.deliverableType).toBe('CODE_ANALYSIS');

    const saved = readFileSync(join(targetDir, 'deliverables', 'code_analysis_deliverable.md'), 'utf-8');
    expect(saved).toBe('# Code Analysis\n\nFindings here.');
  });

  it('saves a queue deliverable with valid JSON', async () => {
    const handler = createSaveDeliverableHandler(targetDir);
    const queueContent = JSON.stringify({ vulnerabilities: [{ id: 1, name: 'SQLi' }] });
    const result = await handler({
      deliverable_type: DeliverableType.INJECTION_QUEUE,
      content: queueContent,
    });

    expect(result.isError).toBe(false);
    const response = JSON.parse(result.content[0]!.text);
    expect(response.validated).toBe(true);
  });

  it('rejects invalid queue JSON', async () => {
    const handler = createSaveDeliverableHandler(targetDir);
    const result = await handler({
      deliverable_type: DeliverableType.INJECTION_QUEUE,
      content: 'not valid json',
    });

    expect(result.isError).toBe(true);
    const response = JSON.parse(result.content[0]!.text);
    expect(response.status).toBe('error');
    expect(response.errorType).toBe('ValidationError');
  });

  it('reads content from file_path', async () => {
    const filePath = join(targetDir, 'source-report.md');
    writeFileSync(filePath, '# Report from file');

    const handler = createSaveDeliverableHandler(targetDir);
    const result = await handler({
      deliverable_type: DeliverableType.RECON,
      file_path: filePath,
    });

    expect(result.isError).toBe(false);
    const saved = readFileSync(join(targetDir, 'deliverables', 'recon_deliverable.md'), 'utf-8');
    expect(saved).toBe('# Report from file');
  });

  it('rejects path traversal outside target directory', async () => {
    const handler = createSaveDeliverableHandler(targetDir);
    const result = await handler({
      deliverable_type: DeliverableType.RECON,
      file_path: '../../../etc/passwd',
    });

    expect(result.isError).toBe(true);
    const response = JSON.parse(result.content[0]!.text);
    expect(response.message).toContain('outside the repository');
  });

  it('errors when neither content nor file_path provided', async () => {
    const handler = createSaveDeliverableHandler(targetDir);
    const result = await handler({
      deliverable_type: DeliverableType.RECON,
    });

    expect(result.isError).toBe(true);
    const response = JSON.parse(result.content[0]!.text);
    expect(response.message).toContain('Either "content" or "file_path" must be provided');
  });

  it('rejects symlinked source files even when they resolve inside the repository', async () => {
    const realPath = join(targetDir, 'real-report.md');
    const symlinkPath = join(targetDir, 'linked-report.md');
    writeFileSync(realPath, '# Report from file');
    symlinkSync(realPath, symlinkPath);

    const handler = createSaveDeliverableHandler(targetDir);
    const result = await handler({
      deliverable_type: DeliverableType.RECON,
      file_path: symlinkPath,
    });

    expect(result.isError).toBe(true);
    const response = JSON.parse(result.content[0]!.text);
    expect(response.message).toContain('symbolic link');
  });
});

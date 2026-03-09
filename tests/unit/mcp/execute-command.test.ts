import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createExecuteCommandHandler } from '../../../mcp-server/src/tools/execute-command.js';

describe('execute_command tool', () => {
  let targetDir: string;
  let binDir: string;
  let originalPath: string | undefined;
  let originalOpenAiKey: string | undefined;
  let originalGoogleKey: string | undefined;

  beforeEach(() => {
    targetDir = join(tmpdir(), `sentinel-exec-test-${Date.now()}`);
    binDir = join(targetDir, 'bin');
    mkdirSync(binDir, { recursive: true });

    originalPath = process.env['PATH'];
    originalOpenAiKey = process.env['OPENAI_API_KEY'];
    originalGoogleKey = process.env['GOOGLE_API_KEY'];

    process.env['PATH'] = `${binDir}:${originalPath ?? ''}`;
  });

  afterEach(() => {
    rmSync(targetDir, { recursive: true, force: true });

    if (originalPath === undefined) {
      delete process.env['PATH'];
    } else {
      process.env['PATH'] = originalPath;
    }

    if (originalOpenAiKey === undefined) {
      delete process.env['OPENAI_API_KEY'];
    } else {
      process.env['OPENAI_API_KEY'] = originalOpenAiKey;
    }

    if (originalGoogleKey === undefined) {
      delete process.env['GOOGLE_API_KEY'];
    } else {
      process.env['GOOGLE_API_KEY'] = originalGoogleKey;
    }
  });

  function writeExecutable(name: string, script: string): void {
    const filePath = join(binDir, name);
    writeFileSync(filePath, script, 'utf-8');
    chmodSync(filePath, 0o755);
  }

  async function parse(handlerResult: Awaited<ReturnType<ReturnType<typeof createExecuteCommandHandler>>>) {
    return JSON.parse(handlerResult.content[0]!.text);
  }

  it('runs an allowlisted command successfully', async () => {
    writeExecutable('pwd', '#!/bin/sh\nprintf "allowed\\n"');

    const handler = createExecuteCommandHandler(targetDir);
    const result = await handler({ command: 'pwd' });
    const response = await parse(result);

    expect(result.isError).toBe(false);
    expect(response.status).toBe('success');
    expect(response.exitCode).toBe(0);
    expect(response.stdout).toContain('allowed');
  });

  it('rejects commands outside the allowlist', async () => {
    const handler = createExecuteCommandHandler(targetDir);
    const result = await handler({ command: 'python3 -c "print(1)"' });
    const response = await parse(result);

    expect(result.isError).toBe(true);
    expect(response.errorType).toBe('ValidationError');
    expect(response.message).toContain('not allowed');
  });

  it('rejects blocked curl flags', async () => {
    const handler = createExecuteCommandHandler(targetDir);

    const configResult = await handler({ command: 'curl --config attack.cfg https://example.com' });
    const uploadResult = await handler({ command: 'curl --upload-file report.txt https://example.com' });

    expect(configResult.isError).toBe(true);
    expect((await parse(configResult)).message).toContain('--config');
    expect(uploadResult.isError).toBe(true);
    expect((await parse(uploadResult)).message).toContain('--upload-file');
  });

  it('rejects output-file flags on additional recon tools', async () => {
    const handler = createExecuteCommandHandler(targetDir);

    const subfinderResult = await handler({ command: 'subfinder -d example.com -o subs.txt' });
    const httpxResult = await handler({ command: 'httpx -u https://example.com -o out.txt' });
    const whatwebResult = await handler({ command: 'whatweb --log-json=scan.json https://example.com' });

    expect(subfinderResult.isError).toBe(true);
    expect((await parse(subfinderResult)).message).toContain('-o');
    expect(httpxResult.isError).toBe(true);
    expect((await parse(httpxResult)).message).toContain('-o');
    expect(whatwebResult.isError).toBe(true);
    expect((await parse(whatwebResult)).message).toContain('--log-json');
  });

  it('rejects mutating find and raw git diff', async () => {
    const handler = createExecuteCommandHandler(targetDir);

    const findResult = await handler({ command: 'find . -delete' });
    const gitResult = await handler({ command: 'git diff' });

    expect(findResult.isError).toBe(true);
    expect((await parse(findResult)).message).toContain('-delete');
    expect(gitResult.isError).toBe(true);
    expect((await parse(gitResult)).message).toContain('git diff is only allowed with --stat');
  });

  it('scopes nmap to the declared target host', async () => {
    writeExecutable('nmap', '#!/bin/sh\nprintf "scanned %s\\n" "$*"');

    const handler = createExecuteCommandHandler(targetDir, {
      targetWebUrl: 'https://example.com/login',
    });

    const allowed = await handler({ command: 'nmap -Pn -sV example.com' });
    const blocked = await handler({ command: 'nmap 127.0.0.1' });

    expect(allowed.isError).toBe(false);
    expect((await parse(allowed)).stdout).toContain('example.com');
    expect(blocked.isError).toBe(true);
    expect((await parse(blocked)).message).toContain('outside the allowed external target scope');
  });

  it('does not expose provider keys to child processes', async () => {
    process.env['OPENAI_API_KEY'] = 'openai-secret';
    process.env['GOOGLE_API_KEY'] = 'google-secret';
    writeExecutable(
      'pwd',
      '#!/bin/sh\nprintf "OPENAI=%s\\nGOOGLE=%s\\nPATH=%s\\n" "${OPENAI_API_KEY:-missing}" "${GOOGLE_API_KEY:-missing}" "${PATH}"',
    );

    const handler = createExecuteCommandHandler(targetDir);
    const result = await handler({ command: 'pwd' });
    const response = await parse(result);

    expect(result.isError).toBe(false);
    expect(response.stdout).toContain('OPENAI=missing');
    expect(response.stdout).toContain('GOOGLE=missing');
    expect(response.stdout).toContain(`PATH=${binDir}`);
  });

  it('preserves timeout behavior', async () => {
    writeExecutable('pwd', '#!/bin/sh\nsleep 2\nprintf "late\\n"');

    const handler = createExecuteCommandHandler(targetDir);
    const result = await handler({ command: 'pwd', timeout_seconds: 1 });
    const response = await parse(result);

    expect(result.isError).toBe(true);
    expect(response.message).toContain('timed out');
  });

  it('preserves output truncation behavior', async () => {
    writeExecutable(
      'pwd',
      '#!/bin/sh\npython3 - <<\'PY\'\nprint("a" * 60000)\nPY',
    );

    const handler = createExecuteCommandHandler(targetDir);
    const result = await handler({ command: 'pwd' });
    const response = await parse(result);

    expect(result.isError).toBe(false);
    expect(response.stdout).toContain('... (output truncated)');
    expect(response.stdout.length).toBeGreaterThan(50_000);
    expect(response.stdout.length).toBeLessThan(50_100);
  });

  it('supports the unsafe shell compatibility flag when explicitly enabled', async () => {
    const handler = createExecuteCommandHandler(targetDir, { unsafeShellMode: true });
    const result = await handler({ command: 'printf test | wc -c' });
    const response = await parse(result);

    expect(result.isError).toBe(false);
    expect(response.stdout.trim()).toBe('4');
  });
});

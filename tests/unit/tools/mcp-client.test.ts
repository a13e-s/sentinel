import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';
import { createMcpTools, closeMcpClient } from '../../../src/tools/mcp-client.js';

describe('MCP client integration', () => {
  let targetDir: string;

  beforeAll(() => {
    // Build MCP server before tests
    const mcpServerDir = join(import.meta.dirname, '../../../mcp-server');
    execFileSync('npx', ['tsc'], { cwd: mcpServerDir, stdio: 'pipe' });

    targetDir = join(tmpdir(), `sentinel-mcp-test-${Date.now()}`);
    mkdirSync(targetDir, { recursive: true });
  });

  afterAll(() => {
    rmSync(targetDir, { recursive: true, force: true });
  });

  it('connects to MCP server and returns tools', async () => {
    const { client, tools } = await createMcpTools(targetDir);

    try {
      expect(tools.length).toBeGreaterThanOrEqual(2);

      const toolNames = tools.map((t) => t.name);
      expect(toolNames).toContain('save_deliverable');
      expect(toolNames).toContain('generate_totp');
    } finally {
      await closeMcpClient(client);
    }
  });

  it('save_deliverable tool works through MCP client', async () => {
    const { client, tools } = await createMcpTools(targetDir);

    try {
      const saveTool = tools.find((t) => t.name === 'save_deliverable');
      expect(saveTool).toBeDefined();

      const result = await saveTool!.invoke({
        deliverable_type: 'CODE_ANALYSIS',
        content: '# Test Analysis\n\nTest content.',
      });

      const parsed = JSON.parse(result as string);
      expect(parsed.status).toBe('success');
      expect(parsed.deliverableType).toBe('CODE_ANALYSIS');
    } finally {
      await closeMcpClient(client);
    }
  });

  it('generate_totp tool works through MCP client', async () => {
    const { client, tools } = await createMcpTools(targetDir);

    try {
      const totpTool = tools.find((t) => t.name === 'generate_totp');
      expect(totpTool).toBeDefined();

      const result = await totpTool!.invoke({
        secret: 'JBSWY3DPEHPK3PXP',
      });

      const parsed = JSON.parse(result as string);
      expect(parsed.status).toBe('success');
      expect(parsed.totpCode).toMatch(/^\d{6}$/);
    } finally {
      await closeMcpClient(client);
    }
  });

  it('passes workflow TOTP secret to the MCP server when configured', async () => {
    const { client, tools } = await createMcpTools(targetDir, {
      totpSecret: 'JBSWY3DPEHPK3PXP',
    });

    try {
      const totpTool = tools.find((t) => t.name === 'generate_totp');
      expect(totpTool).toBeDefined();

      const result = await totpTool!.invoke({});

      const parsed = JSON.parse(result as string);
      expect(parsed.status).toBe('success');
      expect(parsed.totpCode).toMatch(/^\d{6}$/);
    } finally {
      await closeMcpClient(client);
    }
  });
});

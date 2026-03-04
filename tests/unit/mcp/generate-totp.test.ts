import { describe, it, expect } from 'vitest';
import { generateTotp } from '../../../mcp-server/src/tools/generate-totp.js';

describe('generate_totp tool', () => {
  // Well-known base32 test secret (RFC 6238 test vector base32 encoding)
  const TEST_SECRET = 'JBSWY3DPEHPK3PXP';

  it('generates a 6-digit TOTP code', async () => {
    const result = await generateTotp({ secret: TEST_SECRET });

    expect(result.isError).toBe(false);
    const response = JSON.parse(result.content[0]!.text);
    expect(response.status).toBe('success');
    expect(response.totpCode).toMatch(/^\d{6}$/);
    expect(response.expiresIn).toBeGreaterThan(0);
    expect(response.expiresIn).toBeLessThanOrEqual(30);
  });

  it('returns an error for empty secret', async () => {
    const result = await generateTotp({ secret: '' });

    expect(result.isError).toBe(true);
    const response = JSON.parse(result.content[0]!.text);
    expect(response.status).toBe('error');
  });

  it('returns an error for invalid base32 secret', async () => {
    const result = await generateTotp({ secret: '!@#$%^&*' });

    expect(result.isError).toBe(true);
    const response = JSON.parse(result.content[0]!.text);
    expect(response.status).toBe('error');
  });

  it('includes timestamp in response', async () => {
    const result = await generateTotp({ secret: TEST_SECRET });

    const response = JSON.parse(result.content[0]!.text);
    expect(response.timestamp).toBeDefined();
    // Should be a valid ISO date string
    expect(new Date(response.timestamp).toISOString()).toBe(response.timestamp);
  });
});

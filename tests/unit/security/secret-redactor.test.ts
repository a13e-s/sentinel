import { describe, expect, it } from 'vitest';
import {
  getAuthenticationRedactionRules,
  redactSensitiveText,
} from '../../../src/security/secret-redactor.js';

describe('secret-redactor', () => {
  it('builds redaction rules from authentication config', () => {
    const rules = getAuthenticationRedactionRules({
      login_type: 'form',
      login_url: 'https://example.com/login',
      credentials: {
        username: 'alice@example.com',
        password: 'Sup3rSecret!',
        totp_secret: 'JBSWY3DPEHPK3PXP',
      },
      login_flow: ['Type $username', 'Type $password'],
      success_condition: { type: 'url', value: '/dashboard' },
    });

    expect(rules).toEqual([
      { label: 'TOTP_SECRET', value: 'JBSWY3DPEHPK3PXP' },
      { label: 'PASSWORD', value: 'Sup3rSecret!' },
      { label: 'USERNAME', value: 'alice@example.com' },
    ]);
  });

  it('redacts configured auth secrets from persisted prompt text', () => {
    const original = [
      'Use username alice@example.com',
      'Password: Sup3rSecret!',
      'generated TOTP code using secret "JBSWY3DPEHPK3PXP"',
    ].join('\n');

    const redacted = redactSensitiveText(original, [
      { label: 'TOTP_SECRET', value: 'JBSWY3DPEHPK3PXP' },
      { label: 'PASSWORD', value: 'Sup3rSecret!' },
      { label: 'USERNAME', value: 'alice@example.com' },
    ]);

    expect(redacted).not.toContain('alice@example.com');
    expect(redacted).not.toContain('Sup3rSecret!');
    expect(redacted).not.toContain('JBSWY3DPEHPK3PXP');
    expect(redacted).toContain('[REDACTED_USERNAME]');
    expect(redacted).toContain('[REDACTED_PASSWORD]');
    expect(redacted).toContain('[REDACTED_TOTP_SECRET]');
  });

  it('redacts bearer tokens as defense in depth', () => {
    const redacted = redactSensitiveText(
      'Authorization: Bearer abc123.secret.token',
      [],
    );

    expect(redacted).toBe('Authorization: Bearer [REDACTED_TOKEN]');
  });
});

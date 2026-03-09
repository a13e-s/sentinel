import type { Authentication } from '../types/config.js';

export interface RedactionRule {
  readonly label: 'USERNAME' | 'PASSWORD' | 'TOTP_SECRET';
  readonly value: string;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build deterministic redaction rules from configured auth secrets.
 * Ordered from most sensitive to least sensitive for stable replacement.
 */
export function getAuthenticationRedactionRules(
  authentication: Authentication | null | undefined,
): RedactionRule[] {
  const credentials = authentication?.credentials;
  if (!credentials) {
    return [];
  }

  const rules: RedactionRule[] = [];

  if (credentials.totp_secret?.length) {
    rules.push({ label: 'TOTP_SECRET', value: credentials.totp_secret });
  }

  if (credentials.password.length) {
    rules.push({ label: 'PASSWORD', value: credentials.password });
  }

  if (credentials.username.length) {
    rules.push({ label: 'USERNAME', value: credentials.username });
  }

  return rules;
}

/**
 * Redact configured secrets before prompts are persisted to audit artifacts.
 */
export function redactSensitiveText(
  content: string,
  rules: readonly RedactionRule[],
): string {
  let redacted = content;

  for (const rule of rules) {
    if (!rule.value.length) continue;
    redacted = redacted.replace(
      new RegExp(escapeRegex(rule.value), 'g'),
      `[REDACTED_${rule.label}]`,
    );
  }

  // Defense in depth for any prompt text that contains bearer-style tokens.
  redacted = redacted.replace(
    /\bBearer\s+[A-Za-z0-9._~+/=-]+\b/g,
    'Bearer [REDACTED_TOKEN]',
  );

  return redacted;
}

/**
 * generate_totp MCP Tool
 *
 * Generates 6-digit TOTP codes for authentication.
 * Based on RFC 6238 (TOTP) and RFC 4226 (HOTP).
 */

import { createHmac } from 'crypto';
import { z } from 'zod';
import { createToolResult, type ToolResult, type GenerateTotpResponse } from '../types/tool-responses.js';
import { base32Decode, validateTotpSecret } from '../validation/totp-validator.js';
import { createCryptoError, createGenericError } from '../utils/error-formatter.js';

/**
 * Input schema for generate_totp tool
 */
export const GenerateTotpInputSchema = z.object({
  secret: z
    .string()
    .min(1)
    .regex(/^[A-Z2-7]+$/i, 'Must be base32-encoded')
    .optional()
    .describe('Optional base32-encoded TOTP secret. If omitted, use the preconfigured workflow secret.'),
});

export type GenerateTotpInput = z.infer<typeof GenerateTotpInputSchema>;

/** Tool description for MCP registration. */
export const GENERATE_TOTP_DESCRIPTION =
  'Generates 6-digit TOTP code for authentication. Use the preconfigured workflow secret by default, or provide a base32-encoded secret explicitly.';

/**
 * Generate HOTP code (RFC 4226)
 */
function generateHOTP(secret: string, counter: number, digits: number = 6): string {
  const key = base32Decode(secret);

  // Convert counter to 8-byte buffer (big-endian)
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));

  // Generate HMAC-SHA1
  const hmac = createHmac('sha1', key);
  hmac.update(counterBuffer);
  const hash = hmac.digest();

  // Dynamic truncation
  const offset = hash[hash.length - 1]! & 0x0f;
  const code =
    ((hash[offset]! & 0x7f) << 24) |
    ((hash[offset + 1]! & 0xff) << 16) |
    ((hash[offset + 2]! & 0xff) << 8) |
    (hash[offset + 3]! & 0xff);

  // Generate digits
  const otp = (code % Math.pow(10, digits)).toString().padStart(digits, '0');
  return otp;
}

/**
 * Generate TOTP code (RFC 6238)
 */
function generateTOTP(secret: string, timeStep: number = 30, digits: number = 6): string {
  const currentTime = Math.floor(Date.now() / 1000);
  const counter = Math.floor(currentTime / timeStep);
  return generateHOTP(secret, counter, digits);
}

/** Get seconds until TOTP code expires. */
function getSecondsUntilExpiration(timeStep: number = 30): number {
  const currentTime = Math.floor(Date.now() / 1000);
  return timeStep - (currentTime % timeStep);
}

/** generate_totp tool implementation. */
export async function generateTotp(args: GenerateTotpInput): Promise<ToolResult> {
  try {
    const secret = args.secret ?? process.env['SENTINEL_TOTP_SECRET'];

    if (!secret) {
      const errorResponse = createCryptoError(
        'No TOTP secret configured. Provide "secret" explicitly or set a workflow secret.',
        false,
      );
      return createToolResult(errorResponse);
    }

    // Validate secret (throws on error)
    validateTotpSecret(secret);

    // Generate TOTP code
    const totpCode = generateTOTP(secret);
    const expiresIn = getSecondsUntilExpiration();
    const timestamp = new Date().toISOString();

    const successResponse: GenerateTotpResponse = {
      status: 'success',
      message: 'TOTP code generated successfully',
      totpCode,
      timestamp,
      expiresIn,
    };

    return createToolResult(successResponse);
  } catch (error) {
    if (error instanceof Error && (error.message.includes('base32') || error.message.includes('TOTP'))) {
      const errorResponse = createCryptoError(error.message, false);
      return createToolResult(errorResponse);
    }

    const errorResponse = createGenericError(error, false);
    return createToolResult(errorResponse);
  }
}

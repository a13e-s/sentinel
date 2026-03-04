/**
 * Error handling utilities for service-layer error classification and wrapping.
 */

import {
  ErrorCode,
  PentestError,
  type PromptErrorResult,
} from '../types/errors.js';
import {
  matchesBillingApiPattern,
  matchesBillingTextPattern,
} from '../utils/billing-detection.js';

export function handlePromptError(
  promptName: string,
  error: Error
): PromptErrorResult {
  return {
    success: false,
    error: new PentestError(
      `Failed to load prompt '${promptName}': ${error.message}`,
      'prompt',
      false,
      { promptName, originalError: error.message },
      undefined,
      error,
    ),
  };
}

const RETRYABLE_PATTERNS = [
  'network',
  'connection',
  'timeout',
  'econnreset',
  'enotfound',
  'econnrefused',
  'rate limit',
  '429',
  'too many requests',
  'server error',
  '5xx',
  'internal server error',
  'service unavailable',
  'bad gateway',
  'mcp server',
  'model unavailable',
  'service temporarily unavailable',
  'api error',
  'terminated',
  'max turns',
  'maximum turns',
];

const NON_RETRYABLE_PATTERNS = [
  'authentication',
  'invalid prompt',
  'out of memory',
  'permission denied',
  'session limit reached',
  'invalid api key',
];

/** Conservative retry classification - unknown errors don't retry (fail-safe default) */
export function isRetryableError(error: Error): boolean {
  const message = error.message.toLowerCase();

  if (NON_RETRYABLE_PATTERNS.some((pattern) => message.includes(pattern))) {
    return false;
  }

  return RETRYABLE_PATTERNS.some((pattern) => message.includes(pattern));
}

/**
 * Classifies errors by ErrorCode for reliable, code-based classification.
 */
function classifyByErrorCode(
  code: ErrorCode,
  retryableFromError: boolean
): { type: string; retryable: boolean } {
  switch (code) {
    case ErrorCode.SPENDING_CAP_REACHED:
    case ErrorCode.INSUFFICIENT_CREDITS:
      return { type: 'BillingError', retryable: true };

    case ErrorCode.API_RATE_LIMITED:
      return { type: 'RateLimitError', retryable: true };

    case ErrorCode.CONFIG_NOT_FOUND:
    case ErrorCode.CONFIG_VALIDATION_FAILED:
    case ErrorCode.CONFIG_PARSE_ERROR:
      return { type: 'ConfigurationError', retryable: false };

    case ErrorCode.PROMPT_LOAD_FAILED:
      return { type: 'ConfigurationError', retryable: false };

    case ErrorCode.GIT_CHECKPOINT_FAILED:
    case ErrorCode.GIT_ROLLBACK_FAILED:
      return { type: 'GitError', retryable: false };

    case ErrorCode.OUTPUT_VALIDATION_FAILED:
    case ErrorCode.DELIVERABLE_NOT_FOUND:
      return { type: 'OutputValidationError', retryable: true };

    case ErrorCode.AGENT_EXECUTION_FAILED:
      return { type: 'AgentExecutionError', retryable: retryableFromError };

    case ErrorCode.REPO_NOT_FOUND:
      return { type: 'ConfigurationError', retryable: false };

    case ErrorCode.AUTH_FAILED:
      return { type: 'AuthenticationError', retryable: false };

    case ErrorCode.BILLING_ERROR:
      return { type: 'BillingError', retryable: true };

    default:
      return { type: 'UnknownError', retryable: retryableFromError };
  }
}

/**
 * Classifies errors for Temporal workflow retry behavior.
 *
 * Classification priority:
 * 1. If error is PentestError with ErrorCode, classify by code (reliable)
 * 2. Fall through to string matching for external errors (SDK, network, etc.)
 */
export function classifyErrorForTemporal(error: unknown): { type: string; retryable: boolean } {
  // === CODE-BASED CLASSIFICATION ===
  if (error instanceof PentestError && error.code !== undefined) {
    return classifyByErrorCode(error.code, error.retryable);
  }

  // === STRING-BASED CLASSIFICATION ===
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();

  // === BILLING ERRORS ===
  if (matchesBillingApiPattern(message) || matchesBillingTextPattern(message)) {
    return { type: 'BillingError', retryable: true };
  }

  // === PERMANENT ERRORS ===
  if (
    message.includes('authentication') ||
    message.includes('api key') ||
    message.includes('401') ||
    message.includes('authentication_error')
  ) {
    return { type: 'AuthenticationError', retryable: false };
  }

  if (
    message.includes('permission') ||
    message.includes('forbidden') ||
    message.includes('403')
  ) {
    return { type: 'PermissionError', retryable: false };
  }

  // Output validation - retryable (must come BEFORE generic 'validation')
  if (
    message.includes('failed output validation') ||
    message.includes('output validation failed')
  ) {
    return { type: 'OutputValidationError', retryable: true };
  }

  if (
    message.includes('invalid_request_error') ||
    message.includes('malformed') ||
    message.includes('validation')
  ) {
    return { type: 'InvalidRequestError', retryable: false };
  }

  if (
    message.includes('request_too_large') ||
    message.includes('too large') ||
    message.includes('413')
  ) {
    return { type: 'RequestTooLargeError', retryable: false };
  }

  if (
    message.includes('enoent') ||
    message.includes('no such file') ||
    message.includes('cli not installed')
  ) {
    return { type: 'ConfigurationError', retryable: false };
  }

  if (
    message.includes('max turns') ||
    message.includes('budget') ||
    message.includes('execution limit') ||
    message.includes('error_max_turns') ||
    message.includes('error_max_budget')
  ) {
    return { type: 'ExecutionLimitError', retryable: false };
  }

  if (
    message.includes('invalid url') ||
    message.includes('invalid target') ||
    message.includes('malformed url') ||
    message.includes('invalid uri')
  ) {
    return { type: 'InvalidTargetError', retryable: false };
  }

  // === TRANSIENT ERRORS (default retryable) ===
  return { type: 'TransientError', retryable: true };
}

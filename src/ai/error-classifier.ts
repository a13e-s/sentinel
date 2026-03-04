/**
 * Per-provider error classification.
 *
 * Pattern-matches on error messages and HTTP status codes to classify
 * errors into categories with retry recommendations.
 */

import { ErrorCode, type ErrorClassification } from '../types/errors.js';
import type { ProviderName } from '../types/providers.js';

/** Classify a provider error into a category with retry recommendation. */
export function classifyError(
  _provider: ProviderName,
  error: Error,
): ErrorClassification {
  const message = error.message.toLowerCase();

  // === Rate Limits (all providers) ===
  if (message.includes('429') || message.includes('rate limit') || message.includes('too many requests')) {
    return {
      category: 'billing',
      code: ErrorCode.API_RATE_LIMITED,
      retryable: true,
      retryDelayMs: extractRetryDelay(message),
      message: error.message,
    };
  }

  // === Auth Errors (all providers) ===
  if (message.includes('401') || message.includes('invalid api key') || message.includes('unauthorized') || message.includes('authentication')) {
    return {
      category: 'billing',
      code: ErrorCode.PROVIDER_AUTH_FAILED,
      retryable: false,
      message: error.message,
    };
  }

  // === Spending Cap / Credits ===
  if (message.includes('spending cap') || message.includes('insufficient') || message.includes('billing') || message.includes('quota')) {
    return {
      category: 'billing',
      code: ErrorCode.SPENDING_CAP_REACHED,
      retryable: false,
      message: error.message,
    };
  }

  // === Context Length ===
  if (message.includes('context length') || message.includes('token limit') || message.includes('too long')) {
    return {
      category: 'validation',
      code: ErrorCode.CONTEXT_LENGTH_EXCEEDED,
      retryable: false,
      message: error.message,
    };
  }

  // === Safety Filters (Google, Anthropic) ===
  if (message.includes('safety') || message.includes('content filter') || message.includes('blocked') || message.includes('harmful')) {
    return {
      category: 'safety',
      code: ErrorCode.SAFETY_FILTER_TRIGGERED,
      retryable: false,
      message: error.message,
    };
  }

  // === Network Errors ===
  if (message.includes('econnrefused') || message.includes('enotfound') || message.includes('etimedout') ||
      message.includes('socket hang up') || message.includes('network') || message.includes('fetch failed')) {
    return {
      category: 'network',
      retryable: true,
      retryDelayMs: 5000,
      message: error.message,
    };
  }

  // === Server Errors (5xx) ===
  if (message.includes('500') || message.includes('502') || message.includes('503') || message.includes('internal server error')) {
    return {
      category: 'network',
      retryable: true,
      retryDelayMs: 10000,
      message: error.message,
    };
  }

  // === Default: unknown but retryable ===
  return {
    category: 'unknown',
    retryable: true,
    retryDelayMs: 5000,
    message: error.message,
  };
}

function extractRetryDelay(message: string): number {
  const match = message.match(/retry after (\d+)/i);
  if (match?.[1]) {
    return parseInt(match[1], 10) * 1000;
  }
  return 30000;
}

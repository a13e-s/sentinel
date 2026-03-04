/**
 * Error type definitions.
 */

/**
 * Specific error codes for reliable classification.
 *
 * ErrorCode provides precision within the coarse PentestErrorType categories.
 * Used by error classifiers for code-based classification (preferred)
 * with string matching as fallback for external errors.
 */
export enum ErrorCode {
  // Config errors
  CONFIG_NOT_FOUND = 'CONFIG_NOT_FOUND',
  CONFIG_VALIDATION_FAILED = 'CONFIG_VALIDATION_FAILED',
  CONFIG_PARSE_ERROR = 'CONFIG_PARSE_ERROR',

  // Agent execution errors
  AGENT_EXECUTION_FAILED = 'AGENT_EXECUTION_FAILED',
  OUTPUT_VALIDATION_FAILED = 'OUTPUT_VALIDATION_FAILED',

  // Provider errors
  API_RATE_LIMITED = 'API_RATE_LIMITED',
  SPENDING_CAP_REACHED = 'SPENDING_CAP_REACHED',
  INSUFFICIENT_CREDITS = 'INSUFFICIENT_CREDITS',
  PROVIDER_AUTH_FAILED = 'PROVIDER_AUTH_FAILED',
  CONTEXT_LENGTH_EXCEEDED = 'CONTEXT_LENGTH_EXCEEDED',
  SAFETY_FILTER_TRIGGERED = 'SAFETY_FILTER_TRIGGERED',

  // Git errors
  GIT_CHECKPOINT_FAILED = 'GIT_CHECKPOINT_FAILED',
  GIT_ROLLBACK_FAILED = 'GIT_ROLLBACK_FAILED',

  // Prompt errors
  PROMPT_LOAD_FAILED = 'PROMPT_LOAD_FAILED',

  // Validation errors
  DELIVERABLE_NOT_FOUND = 'DELIVERABLE_NOT_FOUND',

  // Preflight validation errors
  REPO_NOT_FOUND = 'REPO_NOT_FOUND',
  AUTH_FAILED = 'AUTH_FAILED',
  BILLING_ERROR = 'BILLING_ERROR',
}

export type PentestErrorType =
  | 'config'
  | 'network'
  | 'tool'
  | 'prompt'
  | 'filesystem'
  | 'validation'
  | 'billing'
  | 'safety'
  | 'unknown';

export interface PentestErrorContext {
  [key: string]: unknown;
}

export interface LogEntry {
  timestamp: string;
  context: string;
  error: {
    name: string;
    message: string;
    type: PentestErrorType;
    retryable: boolean;
    stack?: string;
  };
}

/** Structured error with classification metadata for reliable error handling. */
export class PentestError extends Error {
  override name = 'PentestError' as const;
  type: PentestErrorType;
  retryable: boolean;
  context: PentestErrorContext;
  timestamp: string;
  /** Optional specific error code for reliable classification */
  code?: ErrorCode;

  constructor(
    message: string,
    type: PentestErrorType,
    retryable: boolean = false,
    context: PentestErrorContext = {},
    code?: ErrorCode,
    cause?: Error,
  ) {
    super(message, { cause });
    this.type = type;
    this.retryable = retryable;
    this.context = context;
    this.timestamp = new Date().toISOString();
    if (code !== undefined) {
      this.code = code;
    }
  }
}

/** Classification result from the error classifier */
export interface ErrorClassification {
  category: PentestErrorType;
  code?: ErrorCode;
  retryable: boolean;
  retryDelayMs?: number;
  message: string;
}

export interface PromptErrorResult {
  success: false;
  error: Error;
}

/**
 * Workflow error formatting utilities.
 * Pure functions with no side effects — safe for Temporal workflow sandbox.
 */

/** Maps Temporal error type strings to actionable remediation hints. */
const REMEDIATION_HINTS: Record<string, string> = {
  AuthenticationError:
    'Verify provider API key or credentials in .env (OPENAI_API_KEY, GOOGLE_API_KEY, ANTHROPIC_API_KEY, etc.).',
  ConfigurationError: 'Check your CONFIG file path and contents.',
  BillingError:
    'Check your provider billing dashboard. Add credits or wait for spending cap reset.',
  GitError: 'Check repository path and git state.',
  InvalidTargetError: 'Verify the target URL is correct and accessible.',
  PermissionError: 'Check file and network permissions.',
  ExecutionLimitError: 'Agent exceeded maximum turns or budget. Review prompt complexity.',
  ProviderError: 'Check provider availability and model name. Verify the provider is running.',
};

/**
 * Walk the .cause chain to find the innermost error with a .type property.
 * Temporal wraps ApplicationFailure in ActivityFailure — the useful info is inside.
 *
 * Uses duck-typing because workflow code cannot import @temporalio/activity types.
 */
function unwrapActivityError(error: unknown): {
  message: string;
  type: string | null;
} {
  let current: unknown = error;
  let typed: { message: string; type: string } | null = null;

  while (current instanceof Error) {
    if ('type' in current && typeof (current as { type: unknown }).type === 'string') {
      typed = {
        message: current.message,
        type: (current as { type: string }).type,
      };
    }
    current = (current as { cause?: unknown }).cause;
  }

  if (typed) {
    return typed;
  }

  return {
    message: error instanceof Error ? error.message : String(error),
    type: null,
  };
}

/**
 * Format a structured error string from workflow catch context.
 * Segments are delimited by | for multi-line rendering by WorkflowLogger.
 */
export function formatWorkflowError(
  error: unknown,
  currentPhase: string | null,
  currentAgent: string | null
): string {
  const unwrapped = unwrapActivityError(error);

  let phaseContext = 'Pipeline failed';
  if (currentPhase && currentAgent && currentPhase !== currentAgent) {
    phaseContext = `${currentPhase} failed (agent: ${currentAgent})`;
  } else if (currentPhase) {
    phaseContext = `${currentPhase} failed`;
  }

  const segments: string[] = [phaseContext];

  if (unwrapped.type) {
    segments.push(unwrapped.type);
  }

  segments.push(unwrapped.message.replaceAll('|', '/'));

  if (unwrapped.type) {
    const hint = REMEDIATION_HINTS[unwrapped.type];
    if (hint) {
      segments.push(`Hint: ${hint}`);
    }
  }

  return segments.join('|');
}

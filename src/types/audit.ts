/**
 * Audit system type definitions.
 */

import type { ProviderName } from './providers.js';

/**
 * Cross-cutting session metadata used by services, temporal, and audit.
 */
export interface SessionMetadata {
  id: string;
  webUrl: string;
  repoPath?: string;
  outputPath?: string;
  [key: string]: unknown;
}

/**
 * Result data passed to audit system when an agent execution ends.
 * Used by both AuditSession and MetricsTracker.
 */
export interface AgentEndResult {
  attemptNumber: number;
  duration_ms: number;
  cost_usd: number;
  success: boolean;
  model?: string | undefined;
  provider?: ProviderName | undefined;
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  turns?: number | undefined;
  toolCalls?: number | undefined;
  error?: string | undefined;
  checkpoint?: string | undefined;
  isFinalAttempt?: boolean | undefined;
}

/**
 * Agent metrics types used across services and activities.
 * Centralized here to avoid temporal/shared.ts import boundary violations.
 */

import type { AgentName } from './agents.js';
import type { ProviderName } from './providers.js';

export interface AgentMetrics {
  durationMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  numTurns: number | null;
  model?: string | undefined;
  provider?: ProviderName | undefined;
  toolCalls?: number | undefined;
}

/**
 * Correlation context threaded through activity -> service -> executor chain.
 * Lighter than full OpenTelemetry; included in logger attributes for tracing.
 */
export interface TraceContext {
  workflowId: string;
  runId: string;
  agentName: AgentName;
  attemptNumber: number;
}

/**
 * Structured metrics export for external consumption.
 * Returned by MetricsTracker.exportMetrics() as a frozen snapshot.
 */
export interface MetricsSummary {
  workflowId: string;
  runId: string;

  startedAt: string;
  completedAt: string;
  totalDurationMs: number;

  agents: Array<{
    name: AgentName;
    phase: string;
    durationMs: number;
    attempts: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    provider: ProviderName;
    model: string;
    turns: number;
    toolCalls: number;
    status: 'success' | 'failed' | 'skipped';
  }>;

  totals: {
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    agentsSucceeded: number;
    agentsFailed: number;
    agentsSkipped: number;
  };

  findings: {
    totalVulnerabilities: number;
    exploitedCount: number;
    byType: Record<string, number>;
  };
}

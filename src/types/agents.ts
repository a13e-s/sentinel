/**
 * Agent type definitions.
 */

import type { ActivityLogger } from './activity-logger.js';
import type { ModelConfig } from './providers.js';

/**
 * List of all agents in execution order.
 * Used for iteration during resume state checking.
 */
export const ALL_AGENTS = [
  'pre-recon',
  'recon',
  'injection-vuln',
  'xss-vuln',
  'auth-vuln',
  'ssrf-vuln',
  'authz-vuln',
  'injection-exploit',
  'xss-exploit',
  'auth-exploit',
  'ssrf-exploit',
  'authz-exploit',
  'report',
] as const;

/**
 * Agent name type derived from ALL_AGENTS.
 * This ensures type safety and prevents drift between type and array.
 */
export type AgentName = (typeof ALL_AGENTS)[number];

export type AgentValidator = (
  sourceDir: string,
  logger: ActivityLogger,
) => Promise<boolean>;

export type AgentStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'rolled-back';

export interface AgentDefinition {
  name: AgentName;
  displayName: string;
  prerequisites: AgentName[];
  promptTemplate: string;
  deliverableFilename: string;
  /** Queue filename for vuln agents — auto-created as empty when model doesn't save one. */
  queueFilename?: string;
  /** Per-agent model override. Takes priority over config-level and default. */
  model?: ModelConfig;
}

/** Vulnerability types supported by the pipeline. */
export type VulnType = 'injection' | 'xss' | 'auth' | 'ssrf' | 'authz';

/** Decision returned by queue validation for exploitation phase. */
export interface ExploitationDecision {
  shouldExploit: boolean;
  shouldRetry: boolean;
  vulnerabilityCount: number;
  vulnType: VulnType;
}

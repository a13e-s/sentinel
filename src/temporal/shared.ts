/**
 * Shared types and query definitions for the Temporal layer.
 *
 * Imported by both workflow code (V8 isolate) and activity code (Node runtime).
 * Keep free of Node.js-specific APIs.
 */

import { defineQuery } from '@temporalio/workflow';

export type { AgentMetrics } from '../types/metrics.js';
import type { AgentMetrics } from '../types/metrics.js';
import type { PipelineConfig } from '../types/config.js';

export interface PipelineInput {
  webUrl: string;
  repoPath: string;
  configPath?: string;
  outputPath?: string;
  pipelineTestingMode?: boolean;
  pipelineConfig?: PipelineConfig;
  workflowId?: string;
  sessionId?: string;
  resumeFromWorkspace?: string;
  terminatedWorkflows?: string[];
}

export interface ResumeState {
  workspaceName: string;
  originalUrl: string;
  completedAgents: string[];
  checkpointHash: string;
  originalWorkflowId: string;
}

export interface PipelineSummary {
  totalCostUsd: number;
  totalDurationMs: number;
  totalTurns: number;
  agentCount: number;
}

export interface PipelineState {
  status: 'running' | 'completed' | 'failed';
  currentPhase: string | null;
  currentAgent: string | null;
  completedAgents: string[];
  failedAgent: string | null;
  error: string | null;
  startTime: number;
  agentMetrics: Record<string, AgentMetrics>;
  summary: PipelineSummary | null;
}

export interface PipelineProgress extends PipelineState {
  workflowId: string;
  elapsedMs: number;
}

export interface VulnExploitPipelineResult {
  vulnType: string;
  vulnMetrics: AgentMetrics | null;
  exploitMetrics: AgentMetrics | null;
  exploitDecision: {
    shouldExploit: boolean;
    vulnerabilityCount: number;
  } | null;
  error: string | null;
}

export const getProgress = defineQuery<PipelineProgress>('getProgress');

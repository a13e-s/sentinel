/**
 * Metrics Tracker
 *
 * Manages session.json with comprehensive timing, cost, and validation metrics.
 * Tracks attempt-level data for complete forensic trail.
 */

import {
  generateSessionJsonPath,
  type SessionMetadata,
} from './utils.js';
import { atomicWrite, readJson, fileExists } from '../utils/file-io.js';
import { formatTimestamp, calculatePercentage } from '../utils/formatting.js';
import { ErrorCode } from '../types/errors.js';
import type { AgentName, AgentEndResult } from '../types/index.js';
import { ALL_AGENTS } from '../types/agents.js';
import type { ProviderName } from '../types/providers.js';
import type { MetricsSummary } from '../types/metrics.js';

// === Phase Mapping ===

type PhaseName = 'pre-recon' | 'recon' | 'vulnerability-analysis' | 'exploitation' | 'reporting';

const AGENT_PHASE_MAP: Readonly<Record<AgentName, PhaseName>> = Object.freeze({
  'pre-recon': 'pre-recon',
  'recon': 'recon',
  'injection-vuln': 'vulnerability-analysis',
  'xss-vuln': 'vulnerability-analysis',
  'auth-vuln': 'vulnerability-analysis',
  'authz-vuln': 'vulnerability-analysis',
  'ssrf-vuln': 'vulnerability-analysis',
  'injection-exploit': 'exploitation',
  'xss-exploit': 'exploitation',
  'auth-exploit': 'exploitation',
  'authz-exploit': 'exploitation',
  'ssrf-exploit': 'exploitation',
  'report': 'reporting',
});

// === Data Interfaces ===

interface AttemptData {
  attempt_number: number;
  duration_ms: number;
  cost_usd: number;
  success: boolean;
  timestamp: string;
  model?: string | undefined;
  provider?: ProviderName | undefined;
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  turns?: number | undefined;
  toolCalls?: number | undefined;
  error?: string | undefined;
}

interface AgentAuditMetrics {
  status: 'in-progress' | 'success' | 'failed';
  attempts: AttemptData[];
  final_duration_ms: number;
  total_cost_usd: number;
  model?: string | undefined;
  provider?: ProviderName | undefined;
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  turns?: number | undefined;
  toolCalls?: number | undefined;
  checkpoint?: string | undefined;
}

interface PhaseMetrics {
  duration_ms: number;
  duration_percentage: number;
  cost_usd: number;
  agent_count: number;
}

export interface ResumeAttempt {
  workflowId: string;
  timestamp: string;
  terminatedPrevious?: string;
  resumedFromCheckpoint?: string;
}

export interface SessionData {
  session: {
    id: string;
    webUrl: string;
    repoPath?: string;
    status: 'in-progress' | 'completed' | 'failed';
    createdAt: string;
    completedAt?: string;
    originalWorkflowId?: string;
    resumeAttempts?: ResumeAttempt[];
  };
  metrics: {
    total_duration_ms: number;
    total_cost_usd: number;
    phases: Record<string, PhaseMetrics>;
    agents: Record<string, AgentAuditMetrics>;
  };
}

interface ActiveTimer {
  startTime: number;
  attemptNumber: number;
}

/**
 * MetricsTracker - Manages metrics for a session
 */
export class MetricsTracker {
  private sessionMetadata: SessionMetadata;
  private sessionJsonPath: string;
  private data: SessionData | null = null;
  private activeTimers: Map<string, ActiveTimer> = new Map();

  constructor(sessionMetadata: SessionMetadata) {
    this.sessionMetadata = sessionMetadata;
    this.sessionJsonPath = generateSessionJsonPath(sessionMetadata);
  }

  /**
   * Initialize session.json (idempotent)
   *
   * @param workflowId - Optional workflow ID to set as originalWorkflowId for new sessions
   */
  async initialize(workflowId?: string): Promise<void> {
    // Check if session.json already exists
    const exists = await fileExists(this.sessionJsonPath);

    if (exists) {
      // Load existing data
      this.data = await readJson<SessionData>(this.sessionJsonPath);
    } else {
      // Create new session.json
      this.data = this.createInitialData(workflowId);
      await this.save();
    }
  }

  /**
   * Create initial session.json structure
   *
   * @param workflowId - Optional workflow ID to set as originalWorkflowId
   */
  private createInitialData(workflowId?: string): SessionData {
    const sessionData: SessionData = {
      session: {
        id: this.sessionMetadata.id,
        webUrl: this.sessionMetadata.webUrl,
        status: 'in-progress',
        createdAt: (this.sessionMetadata as { createdAt?: string }).createdAt || formatTimestamp(),
        resumeAttempts: [],
      },
      metrics: {
        total_duration_ms: 0,
        total_cost_usd: 0,
        phases: {},
        agents: {},
      },
    };

    // Set originalWorkflowId if provided (for new workspaces)
    if (workflowId) {
      sessionData.session.originalWorkflowId = workflowId;
    }

    // Only add repoPath if it exists
    if (this.sessionMetadata.repoPath) {
      sessionData.session.repoPath = this.sessionMetadata.repoPath;
    }
    return sessionData;
  }

  /**
   * Start tracking an agent execution
   */
  startAgent(agentName: string, attemptNumber: number): void {
    this.activeTimers.set(agentName, {
      startTime: Date.now(),
      attemptNumber,
    });
  }

  /**
   * End agent execution and update metrics
   */
  async endAgent(agentName: string, result: AgentEndResult): Promise<void> {
    if (!this.data) {
      throw new Error(`MetricsTracker not initialized [${ErrorCode.AGENT_EXECUTION_FAILED}]`);
    }

    // 1. Initialize agent metrics if first time seeing this agent
    const existingAgent = this.data.metrics.agents[agentName];
    const agent = existingAgent ?? {
      status: 'in-progress' as const,
      attempts: [],
      final_duration_ms: 0,
      total_cost_usd: 0,
    };
    this.data.metrics.agents[agentName] = agent;

    // 2. Build attempt record with optional fields via conditional spread
    const attempt: AttemptData = {
      attempt_number: result.attemptNumber,
      duration_ms: result.duration_ms,
      cost_usd: result.cost_usd,
      success: result.success,
      timestamp: formatTimestamp(),
      ...(result.model !== undefined && { model: result.model }),
      ...(result.provider !== undefined && { provider: result.provider }),
      ...(result.inputTokens !== undefined && { inputTokens: result.inputTokens }),
      ...(result.outputTokens !== undefined && { outputTokens: result.outputTokens }),
      ...(result.turns !== undefined && { turns: result.turns }),
      ...(result.toolCalls !== undefined && { toolCalls: result.toolCalls }),
      ...(result.error !== undefined && { error: result.error }),
    };

    // 3. Append attempt to history
    agent.attempts.push(attempt);

    // 4. Recalculate total cost across all attempts (includes failures)
    agent.total_cost_usd = agent.attempts.reduce((sum, a) => sum + a.cost_usd, 0);

    // 5. Update agent status based on outcome
    if (result.success) {
      agent.status = 'success';
      agent.final_duration_ms = result.duration_ms;

      // 6. Attach metadata on success
      if (result.model !== undefined) {
        agent.model = result.model;
      }
      if (result.provider !== undefined) {
        agent.provider = result.provider;
      }
      if (result.inputTokens !== undefined) {
        agent.inputTokens = result.inputTokens;
      }
      if (result.outputTokens !== undefined) {
        agent.outputTokens = result.outputTokens;
      }
      if (result.turns !== undefined) {
        agent.turns = result.turns;
      }
      if (result.toolCalls !== undefined) {
        agent.toolCalls = result.toolCalls;
      }
      if (result.checkpoint) {
        agent.checkpoint = result.checkpoint;
      }
    } else {
      if (result.isFinalAttempt) {
        agent.status = 'failed';
      }
    }

    // 7. Clear active timer
    this.activeTimers.delete(agentName);

    // 8. Recalculate phase and session-level aggregations
    this.recalculateAggregations();

    // 9. Persist to session.json
    await this.save();
  }

  /**
   * Update session status
   */
  async updateSessionStatus(status: 'in-progress' | 'completed' | 'failed'): Promise<void> {
    if (!this.data) return;

    this.data.session.status = status;

    if (status === 'completed' || status === 'failed') {
      this.data.session.completedAt = formatTimestamp();
    }

    await this.save();
  }

  /**
   * Add a resume attempt to the session
   *
   * @param workflowId - The new workflow ID for this resume attempt
   * @param terminatedWorkflows - IDs of workflows that were terminated
   * @param checkpointHash - Git checkpoint hash that was restored
   */
  async addResumeAttempt(
    workflowId: string,
    terminatedWorkflows: string[],
    checkpointHash?: string
  ): Promise<void> {
    if (!this.data) {
      throw new Error(`MetricsTracker not initialized [${ErrorCode.AGENT_EXECUTION_FAILED}]`);
    }

    // Ensure originalWorkflowId is set (backfill if missing from old sessions)
    if (!this.data.session.originalWorkflowId) {
      this.data.session.originalWorkflowId = this.data.session.id;
    }

    // Ensure resumeAttempts array exists
    if (!this.data.session.resumeAttempts) {
      this.data.session.resumeAttempts = [];
    }

    // Add new resume attempt
    const resumeAttempt: ResumeAttempt = {
      workflowId,
      timestamp: formatTimestamp(),
    };

    if (terminatedWorkflows.length > 0) {
      resumeAttempt.terminatedPrevious = terminatedWorkflows.join(',');
    }

    if (checkpointHash) {
      resumeAttempt.resumedFromCheckpoint = checkpointHash;
    }

    this.data.session.resumeAttempts.push(resumeAttempt);

    await this.save();
  }

  /**
   * Recalculate aggregations (total duration, total cost, phases)
   */
  private recalculateAggregations(): void {
    if (!this.data) return;

    const agents = this.data.metrics.agents;

    // Only count successful agents
    const successfulAgents = Object.entries(agents).filter(
      ([, data]) => data.status === 'success'
    );

    // Calculate total duration and cost
    const totalDuration = successfulAgents.reduce(
      (sum, [, data]) => sum + data.final_duration_ms,
      0
    );

    const totalCost = successfulAgents.reduce((sum, [, data]) => sum + data.total_cost_usd, 0);

    this.data.metrics.total_duration_ms = totalDuration;
    this.data.metrics.total_cost_usd = totalCost;

    // Calculate phase-level metrics
    this.data.metrics.phases = this.calculatePhaseMetrics(successfulAgents);
  }

  /**
   * Calculate phase-level metrics
   */
  private calculatePhaseMetrics(
    successfulAgents: Array<[string, AgentAuditMetrics]>
  ): Record<string, PhaseMetrics> {
    const phases: Record<PhaseName, AgentAuditMetrics[]> = {
      'pre-recon': [],
      'recon': [],
      'vulnerability-analysis': [],
      'exploitation': [],
      'reporting': [],
    };

    // Group agents by phase using AGENT_PHASE_MAP
    for (const [agentName, agentData] of successfulAgents) {
      const phase = AGENT_PHASE_MAP[agentName as AgentName];
      if (phase) {
        phases[phase].push(agentData);
      }
    }

    // Calculate metrics per phase
    const phaseMetrics: Record<string, PhaseMetrics> = {};
    const totalDuration = this.data?.metrics.total_duration_ms ?? 0;

    for (const [phaseName, agentList] of Object.entries(phases)) {
      if (agentList.length === 0) continue;

      const phaseDuration = agentList.reduce((sum, agent) => sum + agent.final_duration_ms, 0);
      const phaseCost = agentList.reduce((sum, agent) => sum + agent.total_cost_usd, 0);

      phaseMetrics[phaseName] = {
        duration_ms: phaseDuration,
        duration_percentage: calculatePercentage(phaseDuration, totalDuration),
        cost_usd: phaseCost,
        agent_count: agentList.length,
      };
    }

    return phaseMetrics;
  }

  /**
   * Get current metrics
   */
  getMetrics(): SessionData {
    return JSON.parse(JSON.stringify(this.data)) as SessionData;
  }

  /**
   * Export metrics as a structured MetricsSummary snapshot.
   * Returns a frozen object suitable for external consumption.
   */
  exportMetrics(workflowId: string, runId: string): MetricsSummary {
    if (!this.data) {
      throw new Error(`MetricsTracker not initialized [${ErrorCode.AGENT_EXECUTION_FAILED}]`);
    }

    const agents: MetricsSummary['agents'] = [];
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCostUsd = 0;
    let agentsSucceeded = 0;
    let agentsFailed = 0;
    let agentsSkipped = 0;

    for (const agentName of ALL_AGENTS) {
      const agentData = this.data.metrics.agents[agentName];
      const phase = AGENT_PHASE_MAP[agentName];

      if (!agentData) {
        agentsSkipped++;
        agents.push({
          name: agentName,
          phase,
          durationMs: 0,
          attempts: 0,
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          provider: 'ollama',
          model: '',
          turns: 0,
          toolCalls: 0,
          status: 'skipped',
        });
        continue;
      }

      const status = agentData.status === 'success' ? 'success' as const
        : agentData.status === 'failed' ? 'failed' as const
        : 'skipped' as const;

      if (status === 'success') agentsSucceeded++;
      else if (status === 'failed') agentsFailed++;
      else agentsSkipped++;

      const agentCost = agentData.total_cost_usd;
      const agentInputTokens = agentData.inputTokens ?? 0;
      const agentOutputTokens = agentData.outputTokens ?? 0;
      totalCostUsd += agentCost;
      totalInputTokens += agentInputTokens;
      totalOutputTokens += agentOutputTokens;

      agents.push({
        name: agentName,
        phase,
        durationMs: agentData.final_duration_ms,
        attempts: agentData.attempts.length,
        inputTokens: agentInputTokens,
        outputTokens: agentOutputTokens,
        costUsd: agentCost,
        provider: agentData.provider ?? 'ollama',
        model: agentData.model ?? '',
        turns: agentData.turns ?? 0,
        toolCalls: agentData.toolCalls ?? 0,
        status,
      });
    }

    const summary: MetricsSummary = {
      workflowId,
      runId,
      startedAt: this.data.session.createdAt,
      completedAt: this.data.session.completedAt ?? '',
      totalDurationMs: this.data.metrics.total_duration_ms,
      agents,
      totals: {
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        costUsd: totalCostUsd,
        agentsSucceeded,
        agentsFailed,
        agentsSkipped,
      },
      findings: {
        totalVulnerabilities: 0,
        exploitedCount: 0,
        byType: {},
      },
    };

    return Object.freeze(structuredClone(summary));
  }

  /**
   * Save metrics to session.json (atomic write)
   */
  private async save(): Promise<void> {
    if (!this.data) return;
    await atomicWrite(this.sessionJsonPath, this.data);
  }

  /**
   * Reload metrics from disk
   */
  async reload(): Promise<void> {
    this.data = await readJson<SessionData>(this.sessionJsonPath);
  }
}

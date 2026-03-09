/**
 * Agent Execution Service
 *
 * Handles the full agent lifecycle:
 * - Load config via ConfigLoaderService (distributed + raw for model resolution)
 * - Resolve model config using the 5-level precedence chain
 * - Load prompt template using AGENTS[agentName].promptTemplate
 * - Create git checkpoint
 * - Start audit logging
 * - Create LangChain model and MCP tools
 * - Run provider-agnostic agent loop
 * - Spending cap check using isSpendingCapBehavior
 * - Handle failure (rollback, audit, MCP cleanup)
 * - Validate output using AGENTS[agentName].deliverableFilename
 * - Commit on success, log metrics, close MCP client
 *
 * No Temporal dependencies - pure domain logic.
 */

import { fs, path } from 'zx';
import type { ActivityLogger } from '../types/activity-logger.js';
import { type Result, ok, err, isErr } from '../types/result.js';
import { ErrorCode, type PentestErrorType, PentestError } from '../types/errors.js';
import { isSpendingCapBehavior } from '../utils/billing-detection.js';
import { AGENTS } from '../session-manager.js';
import { resolveModelConfig } from '../session-manager.js';
import { loadPrompt } from './prompt-manager.js';
import { createModel } from '../ai/model-factory.js';
import { runAgentLoop, type AgentLoopResult } from '../ai/agent-loop.js';
import { createMcpTools, closeMcpClient } from '../tools/mcp-client.js';
import { getAuthenticationRedactionRules, redactSensitiveText } from '../security/secret-redactor.js';
import {
  createGitCheckpoint,
  commitGitSuccess,
  rollbackGitWorkspace,
  getGitCommitHash,
} from './git-manager.js';
import type { AuditSession } from '../audit/index.js';
import type { AgentEndResult } from '../types/audit.js';
import type { AgentName } from '../types/agents.js';
import type { AgentMetrics } from '../types/metrics.js';
import type { ConfigLoaderService } from './config-loader.js';
import type { MultiServerMCPClient } from '@langchain/mcp-adapters';

/**
 * Input for agent execution.
 */
export interface AgentExecutionInput {
  webUrl: string;
  repoPath: string;
  configPath?: string | undefined;
  pipelineTestingMode?: boolean | undefined;
  attemptNumber: number;
}

interface FailAgentOpts {
  attemptNumber: number;
  loopResult: AgentLoopResult;
  rollbackReason: string;
  errorMessage: string;
  errorCode: ErrorCode;
  category: PentestErrorType;
  retryable: boolean;
  context: Record<string, unknown>;
}

/** Default max turns for the agent loop. */
const DEFAULT_MAX_TURNS = 10_000;

/** Default max cost per agent in USD (0 = unlimited). */
const DEFAULT_MAX_COST_USD = 0;

/**
 * Service for executing agents with full lifecycle management.
 *
 * NOTE: AuditSession is passed per-execution, NOT stored on the service.
 * This is critical for parallel agent execution - each agent needs its own
 * AuditSession instance because AuditSession uses instance state (currentAgentName)
 * to track which agent is currently logging.
 */
export class AgentExecutionService {
  private readonly configLoader: ConfigLoaderService;

  constructor(configLoader: ConfigLoaderService) {
    this.configLoader = configLoader;
  }

  /**
   * Execute an agent with full lifecycle management.
   *
   * @param agentName - Name of the agent to execute
   * @param input - Execution input parameters
   * @param auditSession - Audit session for this specific agent execution
   * @returns Result containing AgentEndResult on success, PentestError on failure
   */
  async execute(
    agentName: AgentName,
    input: AgentExecutionInput,
    auditSession: AuditSession,
    logger: ActivityLogger
  ): Promise<Result<AgentEndResult, PentestError>> {
    const { webUrl, repoPath, configPath, pipelineTestingMode = false, attemptNumber } = input;
    const startTime = Date.now();

    // 1. Load distributed config (for prompt interpolation)
    const configResult = await this.configLoader.loadOptional(configPath);
    if (isErr(configResult)) {
      return configResult;
    }
    const distributedConfig = configResult.value;

    // 2. Load raw config (for model resolution — includes models section)
    const rawConfigResult = await this.configLoader.loadRawOptional(configPath);
    if (isErr(rawConfigResult)) {
      return rawConfigResult;
    }
    const rawConfig = rawConfigResult.value;

    // 3. Resolve model config
    const agentDef = AGENTS[agentName];
    const modelConfig = resolveModelConfig(agentName, rawConfig, agentDef.model);

    // 4. Load prompt
    const promptTemplate = agentDef.promptTemplate;
    let prompt: string;
    try {
      prompt = await loadPrompt(
        promptTemplate,
        { webUrl, repoPath },
        distributedConfig,
        pipelineTestingMode,
        logger
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return err(
        new PentestError(
          `Failed to load prompt for ${agentName}: ${errorMessage}`,
          'prompt',
          false,
          { agentName, promptTemplate, originalError: errorMessage },
          ErrorCode.PROMPT_LOAD_FAILED,
          error instanceof Error ? error : undefined,
        )
      );
    }

    // 5. Create git checkpoint before execution
    try {
      await createGitCheckpoint(repoPath, agentName, attemptNumber, logger);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return err(
        new PentestError(
          `Failed to create git checkpoint for ${agentName}: ${errorMessage}`,
          'filesystem',
          false,
          { agentName, repoPath, originalError: errorMessage },
          ErrorCode.GIT_CHECKPOINT_FAILED,
          error instanceof Error ? error : undefined,
        )
      );
    }

    // 6. Start audit logging
    const promptForAudit = redactSensitiveText(
      prompt,
      getAuthenticationRedactionRules(distributedConfig?.authentication),
    );
    await auditSession.startAgent(agentName, promptForAudit, attemptNumber);

    // 7. Create model and MCP tools
    const model = await createModel(modelConfig);
    let mcpClient: MultiServerMCPClient | null = null;
    let loopResult: AgentLoopResult;

    try {
      const { client, tools } = await createMcpTools(
        repoPath,
        distributedConfig?.authentication?.credentials.totp_secret
          ? { totpSecret: distributedConfig.authentication.credentials.totp_secret }
          : undefined,
      );
      mcpClient = client;

      // 8. Execute agent loop
      loopResult = await runAgentLoop(model, prompt, tools, {
        maxTurns: DEFAULT_MAX_TURNS,
        maxCostUsd: DEFAULT_MAX_COST_USD,
        provider: modelConfig.provider,
        model: modelConfig.model,
      });
    } catch (error) {
      // Unexpected error during agent loop — clean up and return failure
      const elapsed = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (mcpClient) {
        await closeMcpClient(mcpClient);
      }

      await rollbackGitWorkspace(repoPath, 'unexpected error', logger);

      const endResult: AgentEndResult = {
        attemptNumber,
        duration_ms: elapsed,
        cost_usd: 0,
        success: false,
        model: modelConfig.model,
        ...(modelConfig.provider !== undefined && { provider: modelConfig.provider }),
        error: errorMessage,
      };
      await auditSession.endAgent(agentName, endResult);

      return err(
        new PentestError(
          `Agent ${agentName} failed unexpectedly: ${errorMessage}`,
          'unknown',
          true,
          { agentName, originalError: errorMessage },
          ErrorCode.AGENT_EXECUTION_FAILED,
          error instanceof Error ? error : undefined,
        )
      );
    }

    const elapsed = Date.now() - startTime;

    // 9. Spending cap check — defense-in-depth
    if (loopResult.success && loopResult.turns <= 2 && loopResult.totalCost.costUsd === 0) {
      const resultText = loopResult.result || '';
      if (isSpendingCapBehavior(loopResult.turns, loopResult.totalCost.costUsd, resultText)) {
        const failResult = await this.failAgent(agentName, repoPath, auditSession, logger, mcpClient, elapsed, modelConfig, {
          attemptNumber, loopResult,
          rollbackReason: 'spending cap detected',
          errorMessage: `Spending cap likely reached: ${resultText.slice(0, 100)}`,
          errorCode: ErrorCode.SPENDING_CAP_REACHED,
          category: 'billing',
          retryable: true,
          context: { agentName, turns: loopResult.turns, cost: loopResult.totalCost.costUsd },
        });
        return failResult;
      }
    }

    // 10. Handle execution failure
    if (!loopResult.success) {
      const failResult = await this.failAgent(agentName, repoPath, auditSession, logger, mcpClient, elapsed, modelConfig, {
        attemptNumber, loopResult,
        rollbackReason: 'execution failure',
        errorMessage: loopResult.error || 'Agent execution failed',
        errorCode: ErrorCode.AGENT_EXECUTION_FAILED,
        category: 'validation',
        retryable: true,
        context: { agentName, originalError: loopResult.error },
      });
      return failResult;
    }

    // 11. Validate output — check deliverable file exists, auto-save if missing
    const deliverablePath = path.join(repoPath, 'deliverables', agentDef.deliverableFilename);
    let deliverableExists = await fs.pathExists(deliverablePath);

    // Auto-save: if the model produced text but didn't call save_deliverable,
    // save its response as the deliverable. This handles models with unreliable
    // tool calling — the analysis is in the response text.
    if (!deliverableExists && loopResult.result.trim().length > 0) {
      logger.info(`Auto-saving agent response as deliverable (model did not call save_deliverable)`);
      const deliverablesDir = path.join(repoPath, 'deliverables');
      await fs.ensureDir(deliverablesDir);
      await fs.writeFile(deliverablePath, loopResult.result, 'utf-8');
      deliverableExists = true;
    }

    // Auto-create empty queue file for vuln agents if missing.
    // Signals "analysis complete, no exploitable vulns found" to exploitation phase.
    if (agentDef.queueFilename != null) {
      const queuePath = path.join(repoPath, 'deliverables', agentDef.queueFilename);
      const queueExists = await fs.pathExists(queuePath);
      if (!queueExists) {
        logger.info(`Auto-creating empty queue file: ${agentDef.queueFilename}`);
        const deliverablesDir = path.join(repoPath, 'deliverables');
        await fs.ensureDir(deliverablesDir);
        await fs.writeFile(queuePath, '{"vulnerabilities":[]}', 'utf-8');
      }
    }

    if (!deliverableExists) {
      const failResult = await this.failAgent(agentName, repoPath, auditSession, logger, mcpClient, elapsed, modelConfig, {
        attemptNumber, loopResult,
        rollbackReason: 'validation failure',
        errorMessage: `Agent ${agentName} failed output validation — no deliverable and no response text`,
        errorCode: ErrorCode.OUTPUT_VALIDATION_FAILED,
        category: 'validation',
        retryable: true,
        context: { agentName, deliverableFilename: agentDef.deliverableFilename },
      });
      return failResult;
    }

    // 12. Success — commit deliverables, capture checkpoint hash, close MCP
    await commitGitSuccess(repoPath, agentName, logger);
    const commitHash = await getGitCommitHash(repoPath);

    if (mcpClient) {
      await closeMcpClient(mcpClient);
    }

    const endResult: AgentEndResult = {
      attemptNumber,
      duration_ms: elapsed,
      cost_usd: loopResult.totalCost.costUsd,
      success: true,
      model: modelConfig.model,
      ...(modelConfig.provider !== undefined && { provider: modelConfig.provider }),
      ...(loopResult.totalCost.inputTokens > 0 && { inputTokens: loopResult.totalCost.inputTokens }),
      ...(loopResult.totalCost.outputTokens > 0 && { outputTokens: loopResult.totalCost.outputTokens }),
      ...(loopResult.turns > 0 && { turns: loopResult.turns }),
      ...(loopResult.toolCalls > 0 && { toolCalls: loopResult.toolCalls }),
      ...(commitHash != null && { checkpoint: commitHash }),
    };
    await auditSession.endAgent(agentName, endResult);

    return ok(endResult);
  }

  private async failAgent(
    agentName: AgentName,
    repoPath: string,
    auditSession: AuditSession,
    logger: ActivityLogger,
    mcpClient: MultiServerMCPClient | null,
    elapsedMs: number,
    modelConfig: { provider: string; model: string },
    opts: FailAgentOpts
  ): Promise<Result<AgentEndResult, PentestError>> {
    await rollbackGitWorkspace(repoPath, opts.rollbackReason, logger);

    if (mcpClient) {
      await closeMcpClient(mcpClient);
    }

    const endResult: AgentEndResult = {
      attemptNumber: opts.attemptNumber,
      duration_ms: elapsedMs,
      cost_usd: opts.loopResult.totalCost.costUsd,
      success: false,
      model: modelConfig.model,
      ...(modelConfig.provider !== undefined && { provider: modelConfig.provider as AgentEndResult['provider'] }),
      error: opts.errorMessage,
    };
    await auditSession.endAgent(agentName, endResult);

    return err(
      new PentestError(
        opts.errorMessage,
        opts.category,
        opts.retryable,
        opts.context,
        opts.errorCode
      )
    );
  }

  /**
   * Execute an agent, throwing PentestError on failure.
   *
   * This is the preferred method for Temporal activities, which need to
   * catch errors and classify them into ApplicationFailure. Avoids requiring
   * activities to import Result utilities, keeping the boundary clean.
   *
   * @param agentName - Name of the agent to execute
   * @param input - Execution input parameters
   * @param auditSession - Audit session for this specific agent execution
   * @returns AgentEndResult on success
   * @throws PentestError on failure
   */
  async executeOrThrow(
    agentName: AgentName,
    input: AgentExecutionInput,
    auditSession: AuditSession,
    logger: ActivityLogger
  ): Promise<AgentEndResult> {
    const result = await this.execute(agentName, input, auditSession, logger);
    if (isErr(result)) {
      throw result.error;
    }
    return result.value;
  }

  /**
   * Convert AgentEndResult to AgentMetrics for workflow state.
   */
  static toMetrics(endResult: AgentEndResult, _loopResult: AgentLoopResult): AgentMetrics {
    return {
      durationMs: endResult.duration_ms,
      inputTokens: endResult.inputTokens ?? null,
      outputTokens: endResult.outputTokens ?? null,
      costUsd: endResult.cost_usd,
      numTurns: endResult.turns ?? null,
      ...(endResult.model !== undefined && { model: endResult.model }),
      ...(endResult.provider !== undefined && { provider: endResult.provider }),
      ...(endResult.toolCalls !== undefined && { toolCalls: endResult.toolCalls }),
    };
  }
}

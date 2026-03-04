import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AgentEndResult } from '../../../src/types/audit.js';
import type { AgentLoopResult } from '../../../src/ai/agent-loop.js';
import type { ActivityLogger } from '../../../src/types/activity-logger.js';
import { PentestError } from '../../../src/types/errors.js';
import { ErrorCode } from '../../../src/types/errors.js';

// === Mocks ===

const mockLoadOptional = vi.fn();
const mockLoadRawOptional = vi.fn();

const mockConfigLoader = {
  loadOptional: mockLoadOptional,
  loadRawOptional: mockLoadRawOptional,
  load: vi.fn(),
  loadRaw: vi.fn(),
};

const mockLoadPrompt = vi.fn();
vi.mock('../../../src/services/prompt-manager.js', () => ({
  loadPrompt: mockLoadPrompt,
}));

const mockCreateGitCheckpoint = vi.fn();
const mockCommitGitSuccess = vi.fn();
const mockRollbackGitWorkspace = vi.fn();
const mockGetGitCommitHash = vi.fn();

vi.mock('../../../src/services/git-manager.js', () => ({
  createGitCheckpoint: mockCreateGitCheckpoint,
  commitGitSuccess: mockCommitGitSuccess,
  rollbackGitWorkspace: mockRollbackGitWorkspace,
  getGitCommitHash: mockGetGitCommitHash,
}));

const mockCreateModel = vi.fn();
vi.mock('../../../src/ai/model-factory.js', () => ({
  createModel: mockCreateModel,
}));

const mockRunAgentLoop = vi.fn();
vi.mock('../../../src/ai/agent-loop.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/ai/agent-loop.js')>();
  return {
    ...actual,
    runAgentLoop: mockRunAgentLoop,
  };
});

const mockCreateMcpTools = vi.fn();
const mockCloseMcpClient = vi.fn();
vi.mock('../../../src/tools/mcp-client.js', () => ({
  createMcpTools: mockCreateMcpTools,
  closeMcpClient: mockCloseMcpClient,
}));

const mockIsSpendingCapBehavior = vi.fn();
vi.mock('../../../src/utils/billing-detection.js', () => ({
  isSpendingCapBehavior: mockIsSpendingCapBehavior,
}));

const mockPathExists = vi.fn();
const mockEnsureDir = vi.fn();
const mockWriteFile = vi.fn();
vi.mock('zx', () => ({
  fs: {
    pathExists: (...args: unknown[]) => mockPathExists(...args),
    ensureDir: (...args: unknown[]) => mockEnsureDir(...args),
    writeFile: (...args: unknown[]) => mockWriteFile(...args),
  },
  path: {
    join: (...segments: string[]) => segments.join('/'),
  },
}));

// === Helpers ===

function createMockLogger(): ActivityLogger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function createMockAuditSession() {
  return {
    startAgent: vi.fn(),
    endAgent: vi.fn(),
    logEvent: vi.fn(),
    initialize: vi.fn(),
  };
}

function makeSuccessLoopResult(overrides: Partial<AgentLoopResult> = {}): AgentLoopResult {
  return {
    success: true,
    result: 'Agent completed analysis successfully',
    turns: 5,
    totalCost: { inputTokens: 1000, outputTokens: 500, costUsd: 0.05 },
    toolCalls: 3,
    reason: 'complete',
    ...overrides,
  };
}

function makeFailureLoopResult(overrides: Partial<AgentLoopResult> = {}): AgentLoopResult {
  return {
    success: false,
    result: '',
    turns: 2,
    totalCost: { inputTokens: 200, outputTokens: 100, costUsd: 0.01 },
    toolCalls: 0,
    reason: 'error',
    error: 'Model invocation failed',
    ...overrides,
  };
}

// === Tests ===

describe('AgentExecutionService', () => {
  let service: import('../../../src/services/agent-execution.js').AgentExecutionService;
  let logger: ActivityLogger;
  let auditSession: ReturnType<typeof createMockAuditSession>;

  const defaultInput = {
    webUrl: 'https://example.com',
    repoPath: '/tmp/test-repo',
    configPath: '/tmp/config.yaml',
    attemptNumber: 1,
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    // Default mock behavior for the happy path
    mockLoadOptional.mockResolvedValue({ ok: true, value: { avoid: [], focus: [], authentication: null } });
    mockLoadRawOptional.mockResolvedValue({ ok: true, value: null });
    mockLoadPrompt.mockResolvedValue('You are a security testing agent...');
    mockCreateGitCheckpoint.mockResolvedValue({ success: true });
    mockCreateModel.mockReturnValue({ invoke: vi.fn() });
    mockCreateMcpTools.mockResolvedValue({ client: { close: vi.fn() }, tools: [] });
    mockCloseMcpClient.mockResolvedValue(undefined);
    mockRunAgentLoop.mockResolvedValue(makeSuccessLoopResult());
    mockPathExists.mockResolvedValue(true); // Deliverable exists
    mockCommitGitSuccess.mockResolvedValue({ success: true });
    mockGetGitCommitHash.mockResolvedValue('abc123');
    mockIsSpendingCapBehavior.mockReturnValue(false);

    logger = createMockLogger();
    auditSession = createMockAuditSession();

    const { AgentExecutionService } = await import('../../../src/services/agent-execution.js');
    service = new AgentExecutionService(mockConfigLoader as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should execute the full agent lifecycle successfully', async () => {
    const result = await service.execute('pre-recon', defaultInput, auditSession as never, logger);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.success).toBe(true);
      expect(result.value.cost_usd).toBe(0.05);
      expect(result.value.checkpoint).toBe('abc123');
    }

    // Verify lifecycle steps were called
    expect(mockLoadOptional).toHaveBeenCalledWith('/tmp/config.yaml');
    expect(mockLoadPrompt).toHaveBeenCalled();
    expect(mockCreateGitCheckpoint).toHaveBeenCalled();
    expect(auditSession.startAgent).toHaveBeenCalledWith('pre-recon', expect.any(String), 1);
    expect(mockCreateModel).toHaveBeenCalled();
    expect(mockCreateMcpTools).toHaveBeenCalledWith('/tmp/test-repo');
    expect(mockRunAgentLoop).toHaveBeenCalled();
    expect(mockPathExists).toHaveBeenCalled(); // Deliverable check
    expect(mockCommitGitSuccess).toHaveBeenCalled();
    expect(auditSession.endAgent).toHaveBeenCalled();
    expect(mockCloseMcpClient).toHaveBeenCalled();
  });

  it('should return error when config loading fails', async () => {
    mockLoadOptional.mockResolvedValue({
      ok: false,
      error: new PentestError('Config not found', 'config', false, {}, ErrorCode.CONFIG_NOT_FOUND),
    });

    const result = await service.execute('pre-recon', defaultInput, auditSession as never, logger);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(PentestError);
      expect(result.error.code).toBe(ErrorCode.CONFIG_NOT_FOUND);
    }
    // Agent should not have started
    expect(auditSession.startAgent).not.toHaveBeenCalled();
  });

  it('should return error when prompt loading fails', async () => {
    mockLoadPrompt.mockRejectedValue(new Error('Prompt file not found'));

    const result = await service.execute('pre-recon', defaultInput, auditSession as never, logger);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(PentestError);
      expect(result.error.code).toBe(ErrorCode.PROMPT_LOAD_FAILED);
    }
  });

  it('should return error when git checkpoint fails', async () => {
    mockCreateGitCheckpoint.mockRejectedValue(new Error('Git failed'));

    const result = await service.execute('pre-recon', defaultInput, auditSession as never, logger);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(PentestError);
      expect(result.error.code).toBe(ErrorCode.GIT_CHECKPOINT_FAILED);
    }
  });

  it('should handle agent loop failure with rollback', async () => {
    mockRunAgentLoop.mockResolvedValue(makeFailureLoopResult());

    const result = await service.execute('pre-recon', defaultInput, auditSession as never, logger);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(PentestError);
      expect(result.error.code).toBe(ErrorCode.AGENT_EXECUTION_FAILED);
      expect(result.error.retryable).toBe(true);
    }

    expect(mockRollbackGitWorkspace).toHaveBeenCalled();
    expect(auditSession.endAgent).toHaveBeenCalledWith(
      'pre-recon',
      expect.objectContaining({ success: false })
    );
    expect(mockCloseMcpClient).toHaveBeenCalled();
  });

  it('should detect spending cap behavior and fail with retryable error', async () => {
    mockRunAgentLoop.mockResolvedValue(makeSuccessLoopResult({
      turns: 1,
      totalCost: { inputTokens: 10, outputTokens: 5, costUsd: 0 },
      result: 'spending cap reached, please upgrade',
    }));
    mockIsSpendingCapBehavior.mockReturnValue(true);

    const result = await service.execute('pre-recon', defaultInput, auditSession as never, logger);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(ErrorCode.SPENDING_CAP_REACHED);
      expect(result.error.retryable).toBe(true);
    }
  });

  it('should fail when deliverable file is not created and response is empty', async () => {
    mockPathExists.mockResolvedValue(false); // Deliverable missing
    mockRunAgentLoop.mockResolvedValue(makeSuccessLoopResult({ result: '' })); // No response text

    const result = await service.execute('pre-recon', defaultInput, auditSession as never, logger);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(ErrorCode.OUTPUT_VALIDATION_FAILED);
      expect(result.error.retryable).toBe(true);
    }
    expect(mockRollbackGitWorkspace).toHaveBeenCalled();
  });

  it('should auto-save deliverable when model produces text but does not call save_deliverable', async () => {
    // First pathExists check returns false (no deliverable), second returns true (after auto-save)
    mockPathExists.mockResolvedValueOnce(false);
    mockEnsureDir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
    mockRunAgentLoop.mockResolvedValue(makeSuccessLoopResult({
      result: '# Security Analysis\nFound XSS in login form.',
      toolCalls: 0,
    }));

    const result = await service.execute('pre-recon', defaultInput, auditSession as never, logger);

    expect(result.ok).toBe(true);
    expect(mockEnsureDir).toHaveBeenCalled();
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining('code_analysis_deliverable.md'),
      '# Security Analysis\nFound XSS in login form.',
      'utf-8',
    );
  });

  it('should work without config path (optional config)', async () => {
    const input = { ...defaultInput, configPath: undefined };

    const result = await service.execute('pre-recon', input, auditSession as never, logger);

    expect(result.ok).toBe(true);
    expect(mockLoadOptional).toHaveBeenCalledWith(undefined);
  });

  it('should resolve model config using raw config', async () => {
    mockLoadRawOptional.mockResolvedValue({
      ok: true,
      value: {
        models: {
          default: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
        },
      },
    });

    await service.execute('pre-recon', defaultInput, auditSession as never, logger);

    expect(mockLoadRawOptional).toHaveBeenCalledWith('/tmp/config.yaml');
    expect(mockCreateModel).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'anthropic', model: 'claude-sonnet-4-20250514' })
    );
  });

  it('should close MCP client even on agent loop failure', async () => {
    mockRunAgentLoop.mockRejectedValue(new Error('Unexpected error'));

    const result = await service.execute('pre-recon', defaultInput, auditSession as never, logger);

    expect(result.ok).toBe(false);
    expect(mockCloseMcpClient).toHaveBeenCalled();
  });

  it('should populate AgentEndResult with provider-specific metrics', async () => {
    mockLoadRawOptional.mockResolvedValue({
      ok: true,
      value: {
        models: { default: { provider: 'google', model: 'gemini-2.5-pro' } },
      },
    });
    mockRunAgentLoop.mockResolvedValue(makeSuccessLoopResult({
      totalCost: { inputTokens: 2000, outputTokens: 800, costUsd: 0.12 },
      turns: 8,
      toolCalls: 15,
    }));

    const result = await service.execute('pre-recon', defaultInput, auditSession as never, logger);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.provider).toBe('google');
      expect(result.value.model).toBe('gemini-2.5-pro');
      expect(result.value.inputTokens).toBe(2000);
      expect(result.value.outputTokens).toBe(800);
      expect(result.value.turns).toBe(8);
      expect(result.value.toolCalls).toBe(15);
    }
  });

  describe('executeOrThrow', () => {
    it('should return AgentEndResult on success', async () => {
      const result = await service.executeOrThrow('pre-recon', defaultInput, auditSession as never, logger);

      expect(result.success).toBe(true);
      expect(result.cost_usd).toBe(0.05);
    });

    it('should throw PentestError on failure', async () => {
      mockRunAgentLoop.mockResolvedValue(makeFailureLoopResult());

      await expect(
        service.executeOrThrow('pre-recon', defaultInput, auditSession as never, logger)
      ).rejects.toThrow(PentestError);
    });
  });

  describe('toMetrics', () => {
    it('should convert AgentEndResult and AgentLoopResult to AgentMetrics', async () => {
      const { AgentExecutionService } = await import('../../../src/services/agent-execution.js');

      const endResult: AgentEndResult = {
        attemptNumber: 1,
        duration_ms: 5000,
        cost_usd: 0.05,
        success: true,
        model: 'gemini-2.5-pro',
        provider: 'google',
        inputTokens: 1000,
        outputTokens: 500,
        turns: 5,
        toolCalls: 3,
      };

      const loopResult = makeSuccessLoopResult();

      const metrics = AgentExecutionService.toMetrics(endResult, loopResult);

      expect(metrics.durationMs).toBe(5000);
      expect(metrics.costUsd).toBe(0.05);
      expect(metrics.inputTokens).toBe(1000);
      expect(metrics.outputTokens).toBe(500);
      expect(metrics.numTurns).toBe(5);
      expect(metrics.model).toBe('gemini-2.5-pro');
      expect(metrics.provider).toBe('google');
      expect(metrics.toolCalls).toBe(3);
    });
  });
});

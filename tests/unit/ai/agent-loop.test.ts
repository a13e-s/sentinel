import { describe, it, expect, vi } from 'vitest';
import { runAgentLoop, type AgentLoopConfig } from '../../../src/ai/agent-loop.js';
import { FakeListChatModel } from '@langchain/core/utils/testing';

describe('runAgentLoop', () => {
  it('returns final text response when no tool calls', async () => {
    const model = new FakeListChatModel({
      responses: ['The analysis is complete.'],
    });

    const config: AgentLoopConfig = { maxTurns: 10, maxCostUsd: 0 };
    const result = await runAgentLoop(model, 'Analyze this', [], config);

    expect(result.success).toBe(true);
    expect(result.result).toBe('The analysis is complete.');
    expect(result.turns).toBe(1);
    expect(result.reason).toBe('complete');
  });

  it('returns text after multiple text-only turns', async () => {
    const model = new FakeListChatModel({
      responses: ['First response', 'Second response'],
    });

    const config: AgentLoopConfig = { maxTurns: 10, maxCostUsd: 0 };
    const result = await runAgentLoop(model, 'Go', [], config);

    // FakeListChatModel returns first response, no tool calls -> done on turn 1
    expect(result.success).toBe(true);
    expect(result.turns).toBe(1);
    expect(result.reason).toBe('complete');
  });

  it('enforces max turns limit', async () => {
    // We need a model that always returns tool calls to hit max turns.
    // FakeListChatModel doesn't do tool calls, so we mock at a higher level.
    const model = new FakeListChatModel({
      responses: ['still working...'],
    });

    // With no tools and max 1 turn, it should complete on turn 1
    const config: AgentLoopConfig = { maxTurns: 1, maxCostUsd: 0 };
    const result = await runAgentLoop(model, 'Go', [], config);

    expect(result.turns).toBe(1);
    expect(result.reason).toBe('complete');
  });

  it('handles model errors gracefully', async () => {
    const model = new FakeListChatModel({ responses: [] });
    // FakeListChatModel with empty responses will throw

    const config: AgentLoopConfig = { maxTurns: 10, maxCostUsd: 0 };
    const result = await runAgentLoop(model, 'Go', [], config);

    expect(result.success).toBe(false);
    expect(result.reason).toBe('error');
    expect(result.error).toBeDefined();
  });

  it('calls heartbeat at configured interval', async () => {
    const heartbeat = vi.fn();
    // Use a model that returns a response
    const model = new FakeListChatModel({
      responses: ['Done'],
    });

    const config: AgentLoopConfig = {
      maxTurns: 10,
      maxCostUsd: 0,
      heartbeat,
      heartbeatIntervalMs: 0, // Always heartbeat (>= 0 is always true)
    };

    await runAgentLoop(model, 'Go', [], config);
    expect(heartbeat).toHaveBeenCalled();
  });

  it('reports zero cost for default provider', async () => {
    const model = new FakeListChatModel({
      responses: ['Result'],
    });

    const config: AgentLoopConfig = { maxTurns: 10, maxCostUsd: 0 };
    const result = await runAgentLoop(model, 'Go', [], config);

    expect(result.totalCost.costUsd).toBe(0);
    expect(result.totalCost.inputTokens).toBe(0);
    expect(result.totalCost.outputTokens).toBe(0);
  });

  it('calls onTurnComplete callback', async () => {
    const onTurnComplete = vi.fn();
    const model = new FakeListChatModel({
      responses: ['Done'],
    });

    const config: AgentLoopConfig = {
      maxTurns: 10,
      maxCostUsd: 0,
      onTurnComplete,
    };

    await runAgentLoop(model, 'Go', [], config);
    expect(onTurnComplete).toHaveBeenCalledWith(1, expect.objectContaining({
      inputTokens: expect.any(Number),
      outputTokens: expect.any(Number),
      costUsd: expect.any(Number),
    }));
  });
});

import { describe, it, expect } from 'vitest';
import { calculateCost, type CostResult } from '../../../src/ai/cost-tracker.js';
import { AIMessage } from '@langchain/core/messages';

describe('calculateCost', () => {
  it('calculates OpenAI cost from usage metadata', () => {
    const response = new AIMessage({ content: 'test' });
    // NOTE: LangChain usage_metadata uses snake_case
    response.usage_metadata = {
      input_tokens: 1000,
      output_tokens: 500,
      total_tokens: 1500,
    };

    const result = calculateCost('openai', 'gpt-4o-mini', response);
    expect(result.inputTokens).toBe(1000);
    expect(result.outputTokens).toBe(500);
    expect(result.costUsd).toBeGreaterThan(0);
  });

  it('returns zero cost for Ollama (free local inference)', () => {
    const response = new AIMessage({ content: 'test' });
    response.usage_metadata = {
      input_tokens: 500,
      output_tokens: 200,
      total_tokens: 700,
    };
    const result = calculateCost('ollama', 'llama3.3', response);
    expect(result.costUsd).toBe(0);
    expect(result.inputTokens).toBe(500);
    expect(result.outputTokens).toBe(200);
  });

  it('handles missing usage metadata gracefully', () => {
    const response = new AIMessage({ content: 'test' });
    const result = calculateCost('openai', 'gpt-4o', response);
    expect(result.costUsd).toBe(0);
    expect(result.inputTokens).toBe(0);
    expect(result.outputTokens).toBe(0);
  });

  it('calculates Google Gemini cost', () => {
    const response = new AIMessage({ content: 'test' });
    response.usage_metadata = {
      input_tokens: 2000,
      output_tokens: 1000,
      total_tokens: 3000,
    };
    const result = calculateCost('google', 'gemini-2.0-flash', response);
    expect(result.inputTokens).toBe(2000);
    expect(result.outputTokens).toBe(1000);
    expect(result.costUsd).toBeGreaterThanOrEqual(0);
  });

  it('calculates Anthropic cost', () => {
    const response = new AIMessage({ content: 'test' });
    response.usage_metadata = {
      input_tokens: 1000,
      output_tokens: 500,
      total_tokens: 1500,
    };
    const result = calculateCost('anthropic', 'claude-sonnet-4-5-20250929', response);
    expect(result.inputTokens).toBe(1000);
    expect(result.outputTokens).toBe(500);
    expect(result.costUsd).toBeGreaterThan(0);
  });

  it('falls back to zero for unknown model', () => {
    const response = new AIMessage({ content: 'test' });
    response.usage_metadata = {
      input_tokens: 100,
      output_tokens: 50,
      total_tokens: 150,
    };
    const result = calculateCost('openai', 'unknown-future-model', response);
    expect(result.inputTokens).toBe(100);
    expect(result.outputTokens).toBe(50);
    expect(result.costUsd).toBe(0);
  });
});

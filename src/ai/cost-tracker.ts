/**
 * Per-provider cost calculation from LangChain usage metadata.
 */

import type { AIMessage, UsageMetadata } from '@langchain/core/messages';
import type { ProviderName } from '../types/providers.js';

export interface CostResult {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

/** Per-million-token pricing. [inputPricePerMillion, outputPricePerMillion] */
type TokenPricing = readonly [number, number];

// NOTE: Prices as of early 2026. Update when providers change pricing.
const PRICING: Record<string, TokenPricing> = {
  // OpenAI
  'gpt-4o': [2.5, 10],
  'gpt-4o-mini': [0.15, 0.6],
  'gpt-4-turbo': [10, 30],
  'o1': [15, 60],
  'o1-mini': [3, 12],
  'o3-mini': [1.1, 4.4],

  // Anthropic
  'claude-sonnet-4-5-20250929': [3, 15],
  'claude-haiku-3-5-20241022': [0.8, 4],
  'claude-opus-4-20250514': [15, 75],

  // Google Gemini
  'gemini-2.0-flash': [0.1, 0.4],
  'gemini-2.0-flash-lite': [0.075, 0.3],
  'gemini-1.5-pro': [1.25, 5],
  'gemini-1.5-flash': [0.075, 0.3],
};

/** Calculate cost for a single model response. */
export function calculateCost(
  provider: ProviderName,
  model: string,
  response: AIMessage,
): CostResult {
  // 1. Extract token counts from usage_metadata (snake_case fields)
  const usage = response.usage_metadata as UsageMetadata | undefined;
  const inputTokens = usage?.input_tokens ?? 0;
  const outputTokens = usage?.output_tokens ?? 0;

  // 2. Ollama is free (local inference)
  if (provider === 'ollama') {
    return { inputTokens, outputTokens, costUsd: 0 };
  }

  // 3. Look up pricing for this model
  const pricing = PRICING[model];
  if (!pricing) {
    return { inputTokens, outputTokens, costUsd: 0 };
  }

  // 4. Calculate cost
  const [inputPrice, outputPrice] = pricing;
  const costUsd =
    (inputTokens / 1_000_000) * inputPrice +
    (outputTokens / 1_000_000) * outputPrice;

  return { inputTokens, outputTokens, costUsd };
}

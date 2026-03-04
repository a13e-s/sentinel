/**
 * Provider-agnostic model factory.
 *
 * Creates LangChain BaseChatModel instances from a ModelConfig.
 * All provider-specific constructor logic is isolated here.
 */

import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { ModelConfig } from '../types/providers.js';

/** Create a LangChain chat model from a provider-agnostic ModelConfig. */
export async function createModel(config: ModelConfig): Promise<BaseChatModel> {
  switch (config.provider) {
    case 'openai':
      return createOpenAIModel(config);
    case 'google':
      return createGoogleModel(config);
    case 'ollama':
      return createOllamaModel(config);
    case 'anthropic':
      return createAnthropicModel(config);
    case 'openai-compatible':
      return createOpenAICompatibleModel(config);
    default: {
      const exhaustiveCheck: never = config.provider;
      throw new Error(`Unknown provider: ${exhaustiveCheck}`);
    }
  }
}

// === Provider Constructors ===

// NOTE: We use spread for optional numeric fields to satisfy exactOptionalPropertyTypes.
// LangChain constructors declare `temperature: number` (not `number | undefined`),
// so we must omit the key entirely when the value is undefined.

async function createOpenAIModel(config: ModelConfig): Promise<BaseChatModel> {
  const { ChatOpenAI } = await import('@langchain/openai');
  return new ChatOpenAI({
    model: config.model,
    ...(config.apiKey != null ? { apiKey: config.apiKey } : {}),
    ...(config.temperature != null ? { temperature: config.temperature } : {}),
    ...(config.maxOutputTokens != null ? { maxTokens: config.maxOutputTokens } : {}),
  });
}

async function createGoogleModel(config: ModelConfig): Promise<BaseChatModel> {
  const { ChatGoogleGenerativeAI } = await import('@langchain/google-genai');
  return new ChatGoogleGenerativeAI({
    model: config.model,
    ...(config.apiKey != null ? { apiKey: config.apiKey } : {}),
    ...(config.temperature != null ? { temperature: config.temperature } : {}),
    // NOTE: Google uses maxOutputTokens, not maxTokens
    ...(config.maxOutputTokens != null ? { maxOutputTokens: config.maxOutputTokens } : {}),
  });
}

async function createOllamaModel(config: ModelConfig): Promise<BaseChatModel> {
  const { ChatOllama } = await import('@langchain/ollama');
  return new ChatOllama({
    model: config.model,
    // NOTE: Ollama uses lowercase `baseUrl` (not `baseURL`)
    baseUrl: config.baseUrl ?? 'http://localhost:11434',
    ...(config.temperature != null ? { temperature: config.temperature } : {}),
    ...(config.maxOutputTokens != null ? { numPredict: config.maxOutputTokens } : {}),
    // NOTE: In @langchain/ollama v1.2+, headers is a top-level field
    ...(config.headers != null ? { headers: config.headers } : {}),
  });
}

async function createAnthropicModel(config: ModelConfig): Promise<BaseChatModel> {
  const { ChatAnthropic } = await import('@langchain/anthropic');
  return new ChatAnthropic({
    model: config.model,
    // NOTE: Claude's default maxTokens is 4096 which truncates detailed security reports.
    // 16384 gives agents room for thorough analysis while staying well within Claude's limits.
    maxTokens: config.maxOutputTokens ?? 16384,
    ...(config.apiKey != null ? { apiKey: config.apiKey } : {}),
    ...(config.temperature != null ? { temperature: config.temperature } : {}),
    // NOTE: Anthropic custom headers via clientOptions.defaultHeaders
    ...(config.headers != null
      ? { clientOptions: { defaultHeaders: config.headers } }
      : {}),
  });
}

async function createOpenAICompatibleModel(config: ModelConfig): Promise<BaseChatModel> {
  const { ChatOpenAI } = await import('@langchain/openai');
  return new ChatOpenAI({
    model: config.model,
    apiKey: config.apiKey ?? 'not-needed',
    ...(config.temperature != null ? { temperature: config.temperature } : {}),
    ...(config.maxOutputTokens != null ? { maxTokens: config.maxOutputTokens } : {}),
    // NOTE: OpenAI-compatible uses configuration.baseURL (capital URL)
    ...(config.baseUrl != null ? { configuration: { baseURL: config.baseUrl } } : {}),
  });
}

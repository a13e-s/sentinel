/**
 * Provider-aware preflight validation.
 *
 * Validates provider credentials and availability by making lightweight HTTP
 * requests that do not spend tokens. Each provider has its own validation
 * endpoint and authentication scheme.
 */

import type { ModelConfig } from '../types/providers.js';
import { type Result, ok, err } from '../types/result.js';

const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434';
const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1';
const GOOGLE_API_URL = 'https://generativelanguage.googleapis.com/v1beta';

/** Validate provider credentials and availability without spending tokens. */
export async function validateProvider(config: ModelConfig): Promise<Result<void, string>> {
  try {
    switch (config.provider) {
      case 'openai':
        return await validateOpenAI(config);
      case 'ollama':
        return await validateOllama(config);
      case 'google':
        return await validateGoogle(config);
      case 'anthropic':
        return await validateAnthropic(config);
      case 'openai-compatible':
        return await validateOpenAICompatible(config);
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return err(`Preflight failed for ${config.provider}: ${message}`);
  }
}

// === OpenAI ===

async function validateOpenAI(config: ModelConfig): Promise<Result<void, string>> {
  const baseUrl = config.baseUrl ?? DEFAULT_OPENAI_BASE_URL;
  const response = await fetch(`${baseUrl}/models`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
    },
  });
  return classifyResponse(response, 'openai');
}

// === Ollama ===

async function validateOllama(config: ModelConfig): Promise<Result<void, string>> {
  const baseUrl = config.baseUrl ?? DEFAULT_OLLAMA_BASE_URL;
  const headers: Record<string, string> = {};
  if (config.apiKey) {
    headers['Authorization'] = `Bearer ${config.apiKey}`;
  }
  if (config.headers) {
    Object.assign(headers, config.headers);
  }
  const response = await fetch(`${baseUrl}/api/tags`, {
    method: 'GET',
    headers,
  });
  return classifyResponse(response, 'ollama');
}

// === Google ===

async function validateGoogle(config: ModelConfig): Promise<Result<void, string>> {
  const response = await fetch(`${GOOGLE_API_URL}/models?key=${config.apiKey}`, {
    method: 'GET',
  });
  return classifyResponse(response, 'google');
}

// === Anthropic ===

async function validateAnthropic(config: ModelConfig): Promise<Result<void, string>> {
  const response = await fetch(`${ANTHROPIC_API_URL}/models`, {
    method: 'GET',
    headers: {
      'x-api-key': config.apiKey ?? '',
      'anthropic-version': '2023-06-01',
    },
  });
  return classifyResponse(response, 'anthropic');
}

// === OpenAI-compatible ===

async function validateOpenAICompatible(config: ModelConfig): Promise<Result<void, string>> {
  const baseUrl = config.baseUrl ?? DEFAULT_OPENAI_BASE_URL;
  const response = await fetch(`${baseUrl}/models`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
    },
  });
  return classifyResponse(response, 'openai-compatible');
}

// === Shared ===

function classifyResponse(response: Response, provider: string): Result<void, string> {
  if (response.ok) {
    return ok(undefined);
  }
  if (response.status === 401 || response.status === 403) {
    return err(`Authentication failed for ${provider} (HTTP ${response.status})`);
  }
  return err(`${provider} preflight failed (HTTP ${response.status})`);
}

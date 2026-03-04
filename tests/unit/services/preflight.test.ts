import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { validateProvider } from '../../../src/services/preflight.js';
import { isOk, isErr } from '../../../src/types/result.js';
import type { ModelConfig } from '../../../src/types/providers.js';

describe('validateProvider', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockFetch(response: { ok: boolean; status: number; json?: unknown }): void {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: response.ok,
      status: response.status,
      json: () => Promise.resolve(response.json ?? {}),
      text: () => Promise.resolve(JSON.stringify(response.json ?? {})),
    });
  }

  function mockFetchRejection(error: Error): void {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(error);
  }

  // --- OpenAI ---

  it('validates OpenAI credentials', async () => {
    mockFetch({ ok: true, status: 200, json: { data: [{ id: 'gpt-4' }] } });

    const config: ModelConfig = {
      provider: 'openai',
      model: 'gpt-4',
      apiKey: 'sk-test-key',
    };

    const result = await validateProvider(config);

    expect(isOk(result)).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.openai.com/v1/models',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer sk-test-key',
        }),
      }),
    );
  });

  // --- Ollama (local) ---

  it('validates Ollama availability (local)', async () => {
    mockFetch({ ok: true, status: 200, json: { models: [{ name: 'llama3.3' }] } });

    const config: ModelConfig = {
      provider: 'ollama',
      model: 'llama3.3',
    };

    const result = await validateProvider(config);

    expect(isOk(result)).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:11434/api/tags',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  // --- Ollama (cloud) ---

  it('validates Ollama availability (cloud with custom headers)', async () => {
    mockFetch({ ok: true, status: 200, json: { models: [{ name: 'llama3.3' }] } });

    const config: ModelConfig = {
      provider: 'ollama',
      model: 'llama3.3',
      baseUrl: 'https://ollama.example.com',
      headers: { 'X-Api-Key': 'cloud-secret' },
    };

    const result = await validateProvider(config);

    expect(isOk(result)).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://ollama.example.com/api/tags',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          'X-Api-Key': 'cloud-secret',
        }),
      }),
    );
  });

  // --- Google ---

  it('validates Google credentials', async () => {
    mockFetch({ ok: true, status: 200, json: { models: [] } });

    const config: ModelConfig = {
      provider: 'google',
      model: 'gemini-pro',
      apiKey: 'google-test-key',
    };

    const result = await validateProvider(config);

    expect(isOk(result)).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://generativelanguage.googleapis.com/v1beta/models?key=google-test-key',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  // --- Anthropic ---

  it('validates Anthropic credentials', async () => {
    mockFetch({ ok: true, status: 200, json: { data: [] } });

    const config: ModelConfig = {
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      apiKey: 'sk-ant-test-key',
    };

    const result = await validateProvider(config);

    expect(isOk(result)).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/models',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          'x-api-key': 'sk-ant-test-key',
          'anthropic-version': '2023-06-01',
        }),
      }),
    );
  });

  // --- OpenAI-compatible ---

  it('validates OpenAI-compatible credentials', async () => {
    mockFetch({ ok: true, status: 200, json: { data: [] } });

    const config: ModelConfig = {
      provider: 'openai-compatible',
      model: 'deepseek-chat',
      apiKey: 'compat-key',
      baseUrl: 'https://api.deepseek.com/v1',
    };

    const result = await validateProvider(config);

    expect(isOk(result)).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.deepseek.com/v1/models',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer compat-key',
        }),
      }),
    );
  });

  // --- Error cases ---

  it('returns error for invalid credentials (401)', async () => {
    mockFetch({ ok: false, status: 401 });

    const config: ModelConfig = {
      provider: 'openai',
      model: 'gpt-4',
      apiKey: 'bad-key',
    };

    const result = await validateProvider(config);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toContain('Authentication failed');
    }
  });

  it('returns error when provider is unreachable', async () => {
    mockFetchRejection(new Error('fetch failed'));

    const config: ModelConfig = {
      provider: 'ollama',
      model: 'llama3.3',
    };

    const result = await validateProvider(config);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toContain('fetch failed');
    }
  });

  it('returns error for non-401 HTTP failures', async () => {
    mockFetch({ ok: false, status: 500 });

    const config: ModelConfig = {
      provider: 'google',
      model: 'gemini-pro',
      apiKey: 'some-key',
    };

    const result = await validateProvider(config);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toContain('500');
    }
  });
});

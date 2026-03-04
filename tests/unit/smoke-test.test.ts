import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ProviderName, ModelConfig } from '../../src/types/providers.js';

// Mock model-factory before importing smoke-test
vi.mock('../../src/ai/model-factory.js', () => ({
  createModel: vi.fn(),
}));

// Mock dotenv
vi.mock('dotenv', () => ({
  default: { config: vi.fn() },
}));

import { detectProviders, runProviderSmokeTest, type SmokeTestResult } from '../../src/smoke-test.js';
import { createModel } from '../../src/ai/model-factory.js';

const mockCreateModel = vi.mocked(createModel);

describe('smoke-test', () => {
  const savedEnv = process.env;

  beforeEach(() => {
    process.env = { ...savedEnv };
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = savedEnv;
  });

  // === detectProviders ===

  describe('detectProviders', () => {
    it('returns empty array when no provider env vars are set', () => {
      delete process.env['OPENAI_API_KEY'];
      delete process.env['GOOGLE_API_KEY'];
      delete process.env['ANTHROPIC_API_KEY'];
      delete process.env['OLLAMA_BASE_URL'];
      delete process.env['SENTINEL_MODEL'];

      const providers = detectProviders();
      expect(providers).toEqual([]);
    });

    it('detects OpenAI from OPENAI_API_KEY', () => {
      process.env['OPENAI_API_KEY'] = 'sk-test-123';
      const providers = detectProviders();
      expect(providers).toContainEqual(
        expect.objectContaining({ provider: 'openai' }),
      );
    });

    it('detects Google from GOOGLE_API_KEY', () => {
      process.env['GOOGLE_API_KEY'] = 'AIza-test';
      const providers = detectProviders();
      expect(providers).toContainEqual(
        expect.objectContaining({ provider: 'google' }),
      );
    });

    it('detects Anthropic from ANTHROPIC_API_KEY', () => {
      process.env['ANTHROPIC_API_KEY'] = 'sk-ant-test';
      const providers = detectProviders();
      expect(providers).toContainEqual(
        expect.objectContaining({ provider: 'anthropic' }),
      );
    });

    it('detects Ollama from OLLAMA_BASE_URL', () => {
      process.env['OLLAMA_BASE_URL'] = 'http://localhost:11434';
      const providers = detectProviders();
      expect(providers).toContainEqual(
        expect.objectContaining({ provider: 'ollama' }),
      );
    });

    it('detects multiple providers simultaneously', () => {
      process.env['OPENAI_API_KEY'] = 'sk-test';
      process.env['ANTHROPIC_API_KEY'] = 'sk-ant-test';
      const providers = detectProviders();
      const providerNames = providers.map((p) => p.provider);
      expect(providerNames).toContain('openai');
      expect(providerNames).toContain('anthropic');
    });

    it('uses SENTINEL_MODEL to override provider/model', () => {
      process.env['SENTINEL_MODEL'] = 'google:gemini-2.0-flash';
      process.env['GOOGLE_API_KEY'] = 'AIza-test';
      const providers = detectProviders();
      expect(providers).toContainEqual(
        expect.objectContaining({ provider: 'google', model: 'gemini-2.0-flash' }),
      );
    });
  });

  // === runProviderSmokeTest ===

  describe('runProviderSmokeTest', () => {
    it('returns success when model responds', async () => {
      const mockModel = {
        invoke: vi.fn().mockResolvedValue({ content: 'Hello! I am working.' }),
      };
      mockCreateModel.mockReturnValue(mockModel as never);

      const config: ModelConfig = { provider: 'openai', model: 'gpt-4o-mini' };
      const result = await runProviderSmokeTest(config);

      expect(result.success).toBe(true);
      expect(result.provider).toBe('openai');
      expect(result.model).toBe('gpt-4o-mini');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.error).toBeUndefined();
    });

    it('returns failure when model throws', async () => {
      const mockModel = {
        invoke: vi.fn().mockRejectedValue(new Error('API key invalid')),
      };
      mockCreateModel.mockReturnValue(mockModel as never);

      const config: ModelConfig = { provider: 'openai', model: 'gpt-4o' };
      const result = await runProviderSmokeTest(config);

      expect(result.success).toBe(false);
      expect(result.provider).toBe('openai');
      expect(result.error).toContain('API key invalid');
    });

    it('returns failure when createModel throws', async () => {
      mockCreateModel.mockImplementation(() => {
        throw new Error('Missing provider package');
      });

      const config: ModelConfig = { provider: 'anthropic', model: 'claude-sonnet-4-20250514' };
      const result = await runProviderSmokeTest(config);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Missing provider package');
    });

    it('includes timing information', async () => {
      const mockModel = {
        invoke: vi.fn().mockImplementation(
          () => new Promise((resolve) => setTimeout(() => resolve({ content: 'ok' }), 50)),
        ),
      };
      mockCreateModel.mockReturnValue(mockModel as never);

      const config: ModelConfig = { provider: 'ollama', model: 'llama3.3' };
      const result = await runProviderSmokeTest(config);

      expect(result.durationMs).toBeGreaterThanOrEqual(40);
    });

    it('sends a simple test prompt', async () => {
      const mockModel = {
        invoke: vi.fn().mockResolvedValue({ content: 'pong' }),
      };
      mockCreateModel.mockReturnValue(mockModel as never);

      const config: ModelConfig = { provider: 'openai', model: 'gpt-4o-mini' };
      await runProviderSmokeTest(config);

      expect(mockModel.invoke).toHaveBeenCalledTimes(1);
      const callArg = mockModel.invoke.mock.calls[0]![0];
      expect(callArg).toBeDefined();
    });
  });
});

import { describe, it, expect } from 'vitest';
import { createModel } from '../../../src/ai/model-factory.js';
import type { ModelConfig } from '../../../src/types/providers.js';

describe('createModel', () => {
  it('creates ChatOpenAI for openai provider', async () => {
    const config: ModelConfig = {
      provider: 'openai',
      model: 'gpt-4o-mini',
      apiKey: 'test-key',
    };
    const model = await createModel(config);
    expect(model).toBeDefined();
    expect(typeof model.invoke).toBe('function');
  });

  it('creates ChatOllama for ollama provider', async () => {
    const config: ModelConfig = {
      provider: 'ollama',
      model: 'llama3.3',
    };
    const model = await createModel(config);
    expect(model).toBeDefined();
    expect(typeof model.invoke).toBe('function');
  });

  it('creates ChatOllama with custom baseUrl and headers for cloud ollama', async () => {
    const config: ModelConfig = {
      provider: 'ollama',
      model: 'llama3.3',
      baseUrl: 'https://my-cloud-ollama.example.com',
      headers: { Authorization: 'Bearer test-token' },
    };
    const model = await createModel(config);
    expect(model).toBeDefined();
    expect(typeof model.invoke).toBe('function');
  });

  it('creates ChatGoogleGenerativeAI for google provider', async () => {
    const config: ModelConfig = {
      provider: 'google',
      model: 'gemini-2.0-flash',
      apiKey: 'test-key',
    };
    const model = await createModel(config);
    expect(model).toBeDefined();
    expect(typeof model.invoke).toBe('function');
  });

  it('creates ChatAnthropic for anthropic provider', async () => {
    const config: ModelConfig = {
      provider: 'anthropic',
      model: 'claude-sonnet-4-5-20250929',
      apiKey: 'test-key',
    };
    const model = await createModel(config);
    expect(model).toBeDefined();
    expect(typeof model.invoke).toBe('function');
  });

  it('creates ChatOpenAI with baseUrl for openai-compatible provider', async () => {
    const config: ModelConfig = {
      provider: 'openai-compatible',
      model: 'local-model',
      apiKey: 'test-key',
      baseUrl: 'http://localhost:1234/v1',
    };
    const model = await createModel(config);
    expect(model).toBeDefined();
    expect(typeof model.invoke).toBe('function');
  });

  it('throws for unknown provider', async () => {
    const config = {
      provider: 'unknown' as ModelConfig['provider'],
      model: 'test',
    };
    await expect(createModel(config)).rejects.toThrow('Unknown provider');
  });
});

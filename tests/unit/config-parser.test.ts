import { describe, it, expect } from 'vitest';
import { parseConfig } from '../../src/config-parser.js';

describe('parseConfig', () => {
  it('parses config with models section', () => {
    const yaml = `
models:
  default:
    provider: ollama
    model: llama3.3
  agents:
    recon:
      provider: google
      model: gemini-2.0-flash
`;
    const result = parseConfig(yaml);
    expect(result.models?.default?.provider).toBe('ollama');
    expect(result.models?.default?.model).toBe('llama3.3');
    expect(result.models?.agents?.recon?.provider).toBe('google');
    expect(result.models?.agents?.recon?.model).toBe('gemini-2.0-flash');
  });

  it('parses config without models section (backwards compatible)', () => {
    const yaml = `
authentication:
  login_type: form
  login_url: "https://example.com/login"
  credentials:
    username: testuser
    password: testpass
  login_flow:
    - "Click login"
  success_condition:
    type: url
    value: "/dashboard"
`;
    const result = parseConfig(yaml);
    expect(result.models).toBeUndefined();
    expect(result.authentication?.login_type).toBe('form');
  });

  it('rejects invalid provider name', () => {
    const yaml = `
models:
  default:
    provider: invalid_provider
    model: some-model
`;
    expect(() => parseConfig(yaml)).toThrow();
  });

  it('parses config with rules section', () => {
    const yaml = `
rules:
  avoid:
    - description: "Skip admin panel"
      type: path
      url_path: "/admin"
  focus:
    - description: "Focus on API"
      type: path
      url_path: "/api"
`;
    const result = parseConfig(yaml);
    expect(result.rules?.avoid).toHaveLength(1);
    expect(result.rules?.focus).toHaveLength(1);
    expect(result.rules?.avoid?.[0]?.url_path).toBe('/admin');
  });

  it('parses config with pipeline section', () => {
    const yaml = `
models:
  default:
    provider: ollama
    model: llama3.3
pipeline:
  retry_preset: subscription
  max_concurrent_pipelines: 3
`;
    const result = parseConfig(yaml);
    expect(result.pipeline?.retry_preset).toBe('subscription');
    expect(result.pipeline?.max_concurrent_pipelines).toBe(3);
  });

  it('rejects invalid YAML syntax', () => {
    const yaml = `
models:
  default:
    provider: ollama
    model: [invalid yaml
`;
    expect(() => parseConfig(yaml)).toThrow();
  });

  it('rejects empty input', () => {
    expect(() => parseConfig('')).toThrow();
  });

  it('parses config with per-agent model overrides', () => {
    const yaml = `
models:
  default:
    provider: ollama
    model: llama3.3
  agents:
    pre-recon:
      provider: openai
      model: gpt-4o
    injection-vuln:
      provider: anthropic
      model: claude-sonnet-4-20250514
      temperature: 0.2
`;
    const result = parseConfig(yaml);
    expect(result.models?.agents?.['pre-recon']?.provider).toBe('openai');
    expect(result.models?.agents?.['injection-vuln']?.temperature).toBe(0.2);
  });

  it('parses config with model optional fields', () => {
    const yaml = `
models:
  default:
    provider: openai-compatible
    model: custom-model
    baseUrl: "https://api.example.com/v1"
    apiKey: "sk-test"
    temperature: 0.5
    maxOutputTokens: 4096
`;
    const result = parseConfig(yaml);
    expect(result.models?.default?.provider).toBe('openai-compatible');
    expect(result.models?.default?.baseUrl).toBe('https://api.example.com/v1');
    expect(result.models?.default?.apiKey).toBe('sk-test');
    expect(result.models?.default?.temperature).toBe(0.5);
    expect(result.models?.default?.maxOutputTokens).toBe(4096);
  });
});

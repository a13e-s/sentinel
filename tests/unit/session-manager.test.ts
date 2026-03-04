import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AGENTS, AGENT_PHASE_MAP, resolveModelConfig } from '../../src/session-manager.js';
import { DEFAULT_MODEL_CONFIG } from '../../src/types/providers.js';
import type { AgentName } from '../../src/types/agents.js';
import type { Config } from '../../src/types/config.js';
import type { ModelConfig } from '../../src/types/providers.js';

describe('AGENTS', () => {
  it('defines all 13 agents', () => {
    expect(Object.keys(AGENTS)).toHaveLength(13);
  });

  it('has correct prerequisites for recon', () => {
    expect(AGENTS['recon'].prerequisites).toEqual(['pre-recon']);
  });

  it('has correct prerequisites for vuln agents', () => {
    expect(AGENTS['injection-vuln'].prerequisites).toEqual(['recon']);
    expect(AGENTS['xss-vuln'].prerequisites).toEqual(['recon']);
    expect(AGENTS['auth-vuln'].prerequisites).toEqual(['recon']);
  });

  it('has correct prerequisites for exploit agents', () => {
    expect(AGENTS['injection-exploit'].prerequisites).toEqual(['injection-vuln']);
    expect(AGENTS['xss-exploit'].prerequisites).toEqual(['xss-vuln']);
  });

  it('has correct prerequisites for report agent', () => {
    expect(AGENTS['report'].prerequisites).toEqual([
      'injection-exploit',
      'xss-exploit',
      'auth-exploit',
      'ssrf-exploit',
      'authz-exploit',
    ]);
  });
});

describe('AGENT_PHASE_MAP', () => {
  it('maps all agents to phases', () => {
    expect(Object.keys(AGENT_PHASE_MAP)).toHaveLength(13);
  });

  it('maps vuln agents to vulnerability-analysis phase', () => {
    expect(AGENT_PHASE_MAP['injection-vuln']).toBe('vulnerability-analysis');
    expect(AGENT_PHASE_MAP['xss-vuln']).toBe('vulnerability-analysis');
  });

  it('maps exploit agents to exploitation phase', () => {
    expect(AGENT_PHASE_MAP['injection-exploit']).toBe('exploitation');
    expect(AGENT_PHASE_MAP['auth-exploit']).toBe('exploitation');
  });
});

describe('resolveModelConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.stubEnv('SENTINEL_MODEL', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('prefers agent-level model override', () => {
    const agentOverride: ModelConfig = { provider: 'anthropic', model: 'claude-sonnet-4-20250514' };
    const config: Config = {
      models: {
        default: { provider: 'ollama', model: 'llama3.3' },
        agents: { recon: { provider: 'google', model: 'gemini-2.0-flash' } },
      },
    };

    const result = resolveModelConfig('recon', config, agentOverride);
    expect(result.provider).toBe('anthropic');
    expect(result.model).toBe('claude-sonnet-4-20250514');
  });

  it('falls back to config-level agent override', () => {
    const config: Config = {
      models: {
        default: { provider: 'ollama', model: 'llama3.3' },
        agents: { recon: { provider: 'google', model: 'gemini-2.0-flash' } },
      },
    };

    const result = resolveModelConfig('recon', config);
    expect(result.provider).toBe('google');
    expect(result.model).toBe('gemini-2.0-flash');
  });

  it('falls back to config default', () => {
    const config: Config = {
      models: {
        default: { provider: 'openai', model: 'gpt-4o' },
      },
    };

    const result = resolveModelConfig('recon', config);
    expect(result.provider).toBe('openai');
    expect(result.model).toBe('gpt-4o');
  });

  it('falls back to SENTINEL_MODEL env var', () => {
    vi.stubEnv('SENTINEL_MODEL', 'google:gemini-2.0-flash');

    const result = resolveModelConfig('recon', null);
    expect(result.provider).toBe('google');
    expect(result.model).toBe('gemini-2.0-flash');
  });

  it('falls back to hardcoded default', () => {
    const result = resolveModelConfig('recon', null);
    expect(result.provider).toBe(DEFAULT_MODEL_CONFIG.provider);
    expect(result.model).toBe(DEFAULT_MODEL_CONFIG.model);
  });

  it('ignores config agent override for different agent', () => {
    const config: Config = {
      models: {
        default: { provider: 'ollama', model: 'llama3.3' },
        agents: { recon: { provider: 'google', model: 'gemini-2.0-flash' } },
      },
    };

    const result = resolveModelConfig('pre-recon', config);
    expect(result.provider).toBe('ollama');
    expect(result.model).toBe('llama3.3');
  });

  it('handles config with no models section', () => {
    const config: Config = {
      rules: { avoid: [] },
    };

    const result = resolveModelConfig('recon', config);
    expect(result.provider).toBe(DEFAULT_MODEL_CONFIG.provider);
    expect(result.model).toBe(DEFAULT_MODEL_CONFIG.model);
  });

  it('parses SENTINEL_MODEL env var with openai-compatible provider', () => {
    vi.stubEnv('SENTINEL_MODEL', 'openai-compatible:my-custom-model');

    const result = resolveModelConfig('recon', null);
    expect(result.provider).toBe('openai-compatible');
    expect(result.model).toBe('my-custom-model');
  });

  it('ignores malformed SENTINEL_MODEL env var', () => {
    vi.stubEnv('SENTINEL_MODEL', 'not-a-valid-format');

    const result = resolveModelConfig('recon', null);
    expect(result.provider).toBe(DEFAULT_MODEL_CONFIG.provider);
    expect(result.model).toBe(DEFAULT_MODEL_CONFIG.model);
  });
});

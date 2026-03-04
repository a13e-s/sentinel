/**
 * Agent registry and model configuration resolution.
 * Defines all agents in the pipeline and resolves per-agent model config
 * using the precedence chain: agent override -> config override -> config default -> env var -> hardcoded fallback.
 */

import type { AgentName, AgentDefinition } from './types/agents.js';
import type { Config } from './types/config.js';
import type { ModelConfig, ProviderName } from './types/providers.js';
import { DEFAULT_MODEL_CONFIG } from './types/providers.js';

// === Agent Registry ===

// NOTE: deliverableFilename values must match mcp-server/src/types/deliverables.ts:DELIVERABLE_FILENAMES
export const AGENTS: Readonly<Record<AgentName, AgentDefinition>> = Object.freeze({
  'pre-recon': {
    name: 'pre-recon',
    displayName: 'Pre-recon agent',
    prerequisites: [],
    promptTemplate: 'pre-recon-code',
    deliverableFilename: 'code_analysis_deliverable.md',
  },
  'recon': {
    name: 'recon',
    displayName: 'Recon agent',
    prerequisites: ['pre-recon'],
    promptTemplate: 'recon',
    deliverableFilename: 'recon_deliverable.md',
  },
  'injection-vuln': {
    name: 'injection-vuln',
    displayName: 'Injection vuln agent',
    prerequisites: ['recon'],
    promptTemplate: 'vuln-injection',
    deliverableFilename: 'injection_analysis_deliverable.md',
    queueFilename: 'injection_exploitation_queue.json',
  },
  'xss-vuln': {
    name: 'xss-vuln',
    displayName: 'XSS vuln agent',
    prerequisites: ['recon'],
    promptTemplate: 'vuln-xss',
    deliverableFilename: 'xss_analysis_deliverable.md',
    queueFilename: 'xss_exploitation_queue.json',
  },
  'auth-vuln': {
    name: 'auth-vuln',
    displayName: 'Auth vuln agent',
    prerequisites: ['recon'],
    promptTemplate: 'vuln-auth',
    deliverableFilename: 'auth_analysis_deliverable.md',
    queueFilename: 'auth_exploitation_queue.json',
  },
  'ssrf-vuln': {
    name: 'ssrf-vuln',
    displayName: 'SSRF vuln agent',
    prerequisites: ['recon'],
    promptTemplate: 'vuln-ssrf',
    deliverableFilename: 'ssrf_analysis_deliverable.md',
    queueFilename: 'ssrf_exploitation_queue.json',
  },
  'authz-vuln': {
    name: 'authz-vuln',
    displayName: 'Authz vuln agent',
    prerequisites: ['recon'],
    promptTemplate: 'vuln-authz',
    deliverableFilename: 'authz_analysis_deliverable.md',
    queueFilename: 'authz_exploitation_queue.json',
  },
  'injection-exploit': {
    name: 'injection-exploit',
    displayName: 'Injection exploit agent',
    prerequisites: ['injection-vuln'],
    promptTemplate: 'exploit-injection',
    deliverableFilename: 'injection_exploitation_evidence.md',
  },
  'xss-exploit': {
    name: 'xss-exploit',
    displayName: 'XSS exploit agent',
    prerequisites: ['xss-vuln'],
    promptTemplate: 'exploit-xss',
    deliverableFilename: 'xss_exploitation_evidence.md',
  },
  'auth-exploit': {
    name: 'auth-exploit',
    displayName: 'Auth exploit agent',
    prerequisites: ['auth-vuln'],
    promptTemplate: 'exploit-auth',
    deliverableFilename: 'auth_exploitation_evidence.md',
  },
  'ssrf-exploit': {
    name: 'ssrf-exploit',
    displayName: 'SSRF exploit agent',
    prerequisites: ['ssrf-vuln'],
    promptTemplate: 'exploit-ssrf',
    deliverableFilename: 'ssrf_exploitation_evidence.md',
  },
  'authz-exploit': {
    name: 'authz-exploit',
    displayName: 'Authz exploit agent',
    prerequisites: ['authz-vuln'],
    promptTemplate: 'exploit-authz',
    deliverableFilename: 'authz_exploitation_evidence.md',
  },
  'report': {
    name: 'report',
    displayName: 'Report agent',
    prerequisites: ['injection-exploit', 'xss-exploit', 'auth-exploit', 'ssrf-exploit', 'authz-exploit'],
    promptTemplate: 'report-executive',
    deliverableFilename: 'comprehensive_security_assessment_report.md',
  },
});

// === Phase Mapping ===

export type PhaseName = 'pre-recon' | 'recon' | 'vulnerability-analysis' | 'exploitation' | 'reporting';

export const AGENT_PHASE_MAP: Readonly<Record<AgentName, PhaseName>> = Object.freeze({
  'pre-recon': 'pre-recon',
  'recon': 'recon',
  'injection-vuln': 'vulnerability-analysis',
  'xss-vuln': 'vulnerability-analysis',
  'auth-vuln': 'vulnerability-analysis',
  'authz-vuln': 'vulnerability-analysis',
  'ssrf-vuln': 'vulnerability-analysis',
  'injection-exploit': 'exploitation',
  'xss-exploit': 'exploitation',
  'auth-exploit': 'exploitation',
  'authz-exploit': 'exploitation',
  'ssrf-exploit': 'exploitation',
  'report': 'reporting',
});

// === MCP Agent Mapping ===

// Maps promptTemplate values to MCP server instances for browser automation
export const MCP_AGENT_MAPPING: Readonly<Record<string, string>> = Object.freeze({
  'pre-recon-code': 'playwright-agent1',
  'recon': 'playwright-agent2',
  'vuln-injection': 'playwright-agent1',
  'vuln-xss': 'playwright-agent2',
  'vuln-auth': 'playwright-agent3',
  'vuln-ssrf': 'playwright-agent4',
  'vuln-authz': 'playwright-agent5',
  'exploit-injection': 'playwright-agent1',
  'exploit-xss': 'playwright-agent2',
  'exploit-auth': 'playwright-agent3',
  'exploit-ssrf': 'playwright-agent4',
  'exploit-authz': 'playwright-agent5',
  'report-executive': 'playwright-agent3',
});

// === Model Resolution ===

const VALID_PROVIDERS = new Set<string>([
  'openai',
  'google',
  'ollama',
  'anthropic',
  'openai-compatible',
]);

/**
 * Parse the SENTINEL_MODEL env var (format: "provider:model").
 * Returns null if the env var is unset, empty, or malformed.
 */
function parseEnvModel(): ModelConfig | null {
  const envValue = process.env['SENTINEL_MODEL'];
  if (!envValue) return null;

  // Handle "openai-compatible:model" — split on first colon after the provider
  const colonIndex = envValue.indexOf(':');
  if (colonIndex === -1) return null;

  // "openai-compatible" contains a hyphen, so check if the provider prefix
  // extends past the first colon (e.g. "openai-compatible:model")
  let provider: string;
  let model: string;

  if (envValue.startsWith('openai-compatible:')) {
    provider = 'openai-compatible';
    model = envValue.slice('openai-compatible:'.length);
  } else {
    provider = envValue.slice(0, colonIndex);
    model = envValue.slice(colonIndex + 1);
  }

  if (!provider || !model || !VALID_PROVIDERS.has(provider)) return null;

  return enrichWithEnvCredentials({ provider: provider as ProviderName, model });
}

/**
 * Attach provider-specific credentials from environment variables to a ModelConfig.
 * This fills in apiKey, baseUrl, and headers from well-known env vars when
 * the config was resolved from SENTINEL_MODEL (which only carries provider + model).
 */
function enrichWithEnvCredentials(config: ModelConfig): ModelConfig {
  switch (config.provider) {
    case 'ollama': {
      const baseUrl = process.env['OLLAMA_BASE_URL'];
      const apiKey = process.env['OLLAMA_API_KEY'];
      const rawHeaders = process.env['OLLAMA_HEADERS'];
      const headers: Record<string, string> = {};
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }
      if (rawHeaders) {
        for (const pair of rawHeaders.split(',')) {
          const eqIdx = pair.indexOf('=');
          if (eqIdx > 0) {
            headers[pair.slice(0, eqIdx).trim()] = pair.slice(eqIdx + 1).trim();
          }
        }
      }
      return {
        ...config,
        ...(baseUrl != null ? { baseUrl } : {}),
        ...(apiKey != null ? { apiKey } : {}),
        ...(Object.keys(headers).length > 0 ? { headers } : {}),
      };
    }
    case 'openai':
      return {
        ...config,
        ...(process.env['OPENAI_API_KEY'] != null ? { apiKey: process.env['OPENAI_API_KEY'] } : {}),
      };
    case 'anthropic':
      return {
        ...config,
        ...(process.env['ANTHROPIC_API_KEY'] != null ? { apiKey: process.env['ANTHROPIC_API_KEY'] } : {}),
      };
    case 'google':
      return {
        ...config,
        ...(process.env['GOOGLE_API_KEY'] != null ? { apiKey: process.env['GOOGLE_API_KEY'] } : {}),
      };
    case 'openai-compatible': {
      const baseUrl = process.env['OPENAI_COMPATIBLE_BASE_URL'];
      const apiKey = process.env['OPENAI_COMPATIBLE_API_KEY'];
      return {
        ...config,
        ...(baseUrl != null ? { baseUrl } : {}),
        ...(apiKey != null ? { apiKey } : {}),
      };
    }
  }
}

/**
 * Resolve the model configuration for an agent using the precedence chain:
 * 1. Agent-level override (from AGENTS registry or passed explicitly)
 * 2. Config-level agent override (YAML models.agents.<name>)
 * 3. Config-level default (YAML models.default)
 * 4. SENTINEL_MODEL env var
 * 5. Hardcoded fallback (DEFAULT_MODEL_CONFIG)
 */
export function resolveModelConfig(
  agentName: AgentName,
  config: Config | null,
  agentOverride?: ModelConfig,
): ModelConfig {
  // 1. Agent-level override
  if (agentOverride) return agentOverride;

  // 2. Config-level agent override
  const configAgentOverride = config?.models?.agents?.[agentName];
  if (configAgentOverride) return configAgentOverride;

  // 3. Config-level default
  const configDefault = config?.models?.default;
  if (configDefault) return configDefault;

  // 4. SENTINEL_MODEL env var
  const envModel = parseEnvModel();
  if (envModel) return envModel;

  // 5. Hardcoded fallback
  return DEFAULT_MODEL_CONFIG;
}

#!/usr/bin/env node

/**
 * Smoke test for configured AI providers.
 *
 * Detects provider credentials from .env, creates a model for each,
 * sends a minimal prompt, and reports results with timing.
 *
 * Usage:
 *   npx tsx src/smoke-test.ts
 *   # or after build:
 *   node dist/smoke-test.js
 */

import dotenv from 'dotenv';
import type { ModelConfig, ProviderName } from './types/providers.js';
import { createModel } from './ai/model-factory.js';
import { HumanMessage } from '@langchain/core/messages';

dotenv.config();

// === Types ===

export interface SmokeTestResult {
  readonly provider: ProviderName;
  readonly model: string;
  readonly success: boolean;
  readonly durationMs: number;
  readonly error?: string;
}

// === Provider Detection ===

/** Default models used when no SENTINEL_MODEL override is set. */
const DEFAULT_MODELS: Record<ProviderName, string> = {
  openai: 'gpt-4o-mini',
  google: 'gemini-2.0-flash',
  anthropic: 'claude-sonnet-4-20250514',
  ollama: 'llama3.3',
  'openai-compatible': 'gpt-4o-mini',
};

/**
 * Detect configured providers from environment variables.
 * Returns a ModelConfig for each provider that has credentials set.
 * If SENTINEL_MODEL is set, its provider/model takes precedence.
 */
export function detectProviders(): ModelConfig[] {
  const configs: ModelConfig[] = [];
  const sentinelModel = parseSentinelModel();

  // Check each provider's env var
  const openaiKey = process.env['OPENAI_API_KEY'];
  if (openaiKey) {
    const isOverride = sentinelModel?.provider === 'openai';
    configs.push({
      provider: 'openai',
      model: isOverride ? sentinelModel.model : DEFAULT_MODELS.openai,
      apiKey: openaiKey,
    });
  }

  const googleKey = process.env['GOOGLE_API_KEY'];
  if (googleKey) {
    const isOverride = sentinelModel?.provider === 'google';
    configs.push({
      provider: 'google',
      model: isOverride ? sentinelModel.model : DEFAULT_MODELS.google,
      apiKey: googleKey,
    });
  }

  const anthropicKey = process.env['ANTHROPIC_API_KEY'];
  if (anthropicKey) {
    const isOverride = sentinelModel?.provider === 'anthropic';
    configs.push({
      provider: 'anthropic',
      model: isOverride ? sentinelModel.model : DEFAULT_MODELS.anthropic,
      apiKey: anthropicKey,
    });
  }

  const ollamaUrl = process.env['OLLAMA_BASE_URL'];
  if (ollamaUrl) {
    const isOverride = sentinelModel?.provider === 'ollama';
    configs.push({
      provider: 'ollama',
      model: isOverride ? sentinelModel.model : DEFAULT_MODELS.ollama,
      baseUrl: ollamaUrl,
    });
  }

  return configs;
}

/** Parse SENTINEL_MODEL env var (format: provider:model). */
function parseSentinelModel(): { provider: ProviderName; model: string } | null {
  const envValue = process.env['SENTINEL_MODEL'];
  if (!envValue) return null;

  const validProviders = new Set<string>([
    'openai', 'google', 'ollama', 'anthropic', 'openai-compatible',
  ]);

  if (envValue.startsWith('openai-compatible:')) {
    return { provider: 'openai-compatible', model: envValue.slice('openai-compatible:'.length) };
  }

  const colonIndex = envValue.indexOf(':');
  if (colonIndex === -1) return null;

  const provider = envValue.slice(0, colonIndex);
  const model = envValue.slice(colonIndex + 1);

  if (!provider || !model || !validProviders.has(provider)) return null;
  return { provider: provider as ProviderName, model };
}

// === Smoke Test Execution ===

const TEST_PROMPT = 'Respond with exactly: SENTINEL_OK';

/**
 * Run a smoke test against a single provider.
 * Creates a model, sends a minimal prompt, and measures response time.
 */
export async function runProviderSmokeTest(config: ModelConfig): Promise<SmokeTestResult> {
  const start = Date.now();

  try {
    const model = await createModel(config);
    await model.invoke([new HumanMessage(TEST_PROMPT)]);

    return {
      provider: config.provider,
      model: config.model,
      success: true,
      durationMs: Date.now() - start,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      provider: config.provider,
      model: config.model,
      success: false,
      durationMs: Date.now() - start,
      error: message,
    };
  }
}

// === CLI Entry Point ===

function formatResult(result: SmokeTestResult): string {
  const status = result.success ? 'PASS' : 'FAIL';
  const timing = `${result.durationMs}ms`;
  const base = `  [${status}] ${result.provider}/${result.model} (${timing})`;
  if (result.error) {
    return `${base}\n         Error: ${result.error}`;
  }
  return base;
}

async function main(): Promise<void> {
  console.log('\nSentinel Smoke Test');
  console.log('===================\n');

  const providers = detectProviders();

  if (providers.length === 0) {
    console.log('No providers detected. Set at least one in .env:');
    console.log('  OPENAI_API_KEY');
    console.log('  GOOGLE_API_KEY');
    console.log('  ANTHROPIC_API_KEY');
    console.log('  OLLAMA_BASE_URL');
    console.log('');
    process.exit(1);
  }

  console.log(`Detected ${providers.length} provider(s):\n`);

  const results: SmokeTestResult[] = [];

  for (const config of providers) {
    console.log(`  Testing ${config.provider}/${config.model}...`);
    const result = await runProviderSmokeTest(config);
    results.push(result);
    console.log(formatResult(result));
    console.log('');
  }

  // Summary
  const passed = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  console.log('---');
  console.log(`Results: ${passed} passed, ${failed} failed out of ${results.length} provider(s)`);
  console.log('');

  if (failed > 0) {
    process.exit(1);
  }
}

// Run when executed directly (not imported)
const isDirectExecution = process.argv[1]?.endsWith('smoke-test.js') ||
  process.argv[1]?.endsWith('smoke-test.ts');

if (isDirectExecution) {
  main().catch((err) => {
    console.error('Smoke test error:', err);
    process.exit(1);
  });
}

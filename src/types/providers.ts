/**
 * Provider and model configuration types.
 */

export type ProviderName =
  | 'openai'
  | 'google'
  | 'ollama'
  | 'anthropic'
  | 'openai-compatible';

export interface ModelConfig {
  readonly provider: ProviderName;
  readonly model: string;
  readonly apiKey?: string;
  readonly baseUrl?: string;
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
  readonly headers?: Record<string, string>;
  // NOTE: `headers` is a config-level field. When constructing ChatOllama,
  // pass as `clientOptions: { headers }`. For ChatAnthropic, pass as
  // `clientOptions: { defaultHeaders }`. For ChatOpenAI, pass via
  // `configuration: { baseURL, apiKey }`.
}

/** Default model used when nothing is configured */
export const DEFAULT_MODEL_CONFIG: ModelConfig = {
  provider: 'ollama',
  model: 'llama3.3',
} as const;

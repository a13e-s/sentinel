import { describe, it, expect } from 'vitest';
import { classifyError } from '../../../src/ai/error-classifier.js';

describe('classifyError', () => {
  it('classifies OpenAI rate limit error', () => {
    const error = new Error('429 Rate limit exceeded');
    const result = classifyError('openai', error);
    expect(result.category).toBe('billing');
    expect(result.retryable).toBe(true);
  });

  it('classifies OpenAI auth error', () => {
    const error = new Error('401 Invalid API key');
    const result = classifyError('openai', error);
    expect(result.category).toBe('billing');
    expect(result.retryable).toBe(false);
  });

  it('classifies Google safety error', () => {
    const error = new Error('SAFETY blocked by content filter');
    const result = classifyError('google', error);
    expect(result.category).toBe('safety');
    expect(result.retryable).toBe(false);
  });

  it('classifies Ollama connection error', () => {
    const error = new Error('connect ECONNREFUSED 127.0.0.1:11434');
    const result = classifyError('ollama', error);
    expect(result.category).toBe('network');
    expect(result.retryable).toBe(true);
  });

  it('classifies context length exceeded', () => {
    const error = new Error('maximum context length exceeded');
    const result = classifyError('openai', error);
    expect(result.category).toBe('validation');
    expect(result.retryable).toBe(false);
  });

  it('classifies spending cap / insufficient credits', () => {
    const error = new Error('spending cap reached');
    const result = classifyError('openai', error);
    expect(result.category).toBe('billing');
    expect(result.retryable).toBe(false);
  });

  it('defaults unknown errors to retryable', () => {
    const error = new Error('Something unexpected happened');
    const result = classifyError('openai', error);
    expect(result.category).toBe('unknown');
    expect(result.retryable).toBe(true);
  });
});

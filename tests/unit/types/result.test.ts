import { describe, it, expect } from 'vitest';
import { ok, err, isOk, isErr, type Result } from '../../../src/types/result.js';

describe('Result type', () => {
  it('ok() creates a success result', () => {
    const result = ok(42);
    expect(isOk(result)).toBe(true);
    expect(isErr(result)).toBe(false);
    expect(result.value).toBe(42);
  });

  it('err() creates an error result', () => {
    const result = err('something failed');
    expect(isErr(result)).toBe(true);
    expect(isOk(result)).toBe(false);
    expect(result.error).toBe('something failed');
  });

  it('works with typed Result', () => {
    const success: Result<number, string> = ok(42);
    const failure: Result<number, string> = err('bad input');

    if (isOk(success)) {
      expect(success.value).toBe(42);
    }
    if (isErr(failure)) {
      expect(failure.error).toBe('bad input');
    }
  });
});

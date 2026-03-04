/**
 * Metrics and Timing Utilities
 *
 * Provides timing instrumentation for async operations.
 */

import type { ActivityLogger } from '../types/activity-logger.js';

/**
 * Wraps an async operation with timing instrumentation.
 * Logs duration on both success and failure. Re-throws on error.
 */
export async function withTiming<T>(
  logger: ActivityLogger,
  operation: string,
  fn: () => Promise<T>,
): Promise<T> {
  const start = performance.now();
  try {
    const result = await fn();
    logger.info(`${operation} completed`, { duration_ms: Math.round(performance.now() - start) });
    return result;
  } catch (error) {
    logger.error(`${operation} failed`, { duration_ms: Math.round(performance.now() - start) });
    throw error;
  }
}

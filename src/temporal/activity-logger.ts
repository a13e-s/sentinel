/**
 * ActivityLogger backed by Temporal's Context.current().log.
 * Must be called inside a running Temporal activity.
 */

import { Context } from '@temporalio/activity';
import type { ActivityLogger } from '../types/activity-logger.js';

export class TemporalActivityLogger implements ActivityLogger {
  info(message: string, attrs?: Record<string, unknown>): void {
    Context.current().log.info(message, attrs ?? {});
  }

  warn(message: string, attrs?: Record<string, unknown>): void {
    Context.current().log.warn(message, attrs ?? {});
  }

  error(message: string, attrs?: Record<string, unknown>): void {
    Context.current().log.error(message, attrs ?? {});
  }
}

/**
 * Create an ActivityLogger. Must be called inside a Temporal activity.
 * Throws if called outside an activity context.
 */
export function createActivityLogger(): ActivityLogger {
  return new TemporalActivityLogger();
}

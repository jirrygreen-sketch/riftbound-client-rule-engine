import type { TimingPointId } from '../timing-points.js';
import type { DelayedDuration } from './duration.js';
import { delayedExpiresAt } from './duration.js';
import type { DelayedTriggerSink } from './registry.js';

/**
 * CR v1.5 359.3.e.16: a delayed ability whose duration has ended before it
 * was generated is not generated. expire checks the expiry timing point
 * against the current timing point before a delayed trigger fires.
 */
export function isExpired(
  duration: DelayedDuration | undefined,
  timingPoint: TimingPointId
): boolean {
  const expiry = delayedExpiresAt(duration);
  return expiry !== undefined && timingPoint === expiry;
}

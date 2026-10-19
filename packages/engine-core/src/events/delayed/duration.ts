import { isTimingPointId, type TimingPointId } from '../timing-points.js';

/**
 * Delayed-ability windows (Core Rules v1.5 391/392).
 *
 * A delayed trigger either spans "this turn" (391.2's frame of time as a
 * restriction; it expires with the 317.1.a "at the end of this turn" timing
 * point) or until a concrete timing point is observed ("next ...", 392's
 * specified time). The frozen registerDelayedTrigger(at, body) contract
 * cannot carry a window, so trigger.delayed encodes it as a spec condition
 * and this module owns the vocabulary.
 */
export type DelayedDuration =
  | { readonly kind: 'this-turn' }
  | { readonly kind: 'until'; readonly at: TimingPointId };

/**
 * "this turn" ends with the Ending Phase's Ending Step (CR 317.1.a) and
 * expires simultaneously there (CR 317.2.c).
 */
export const DELAYED_EXPIRES_AT: TimingPointId = 'turn-end';

/** Timing-point names that denote one-shot "next ..." windows. */
export const DELAYED_UNTIL_TIMINGS: readonly TimingPointId[] = ['main-start', 'combat-start'];

/** Alias table for the window spellings used by card programs. */
export const DELAYED_DURATION_ALIASES: Readonly<Record<string, DelayedDuration>> = {
  'this-turn': { kind: 'this-turn' },
  'end-of-turn': { kind: 'this-turn' },
  'turn-end': { kind: 'this-turn' },
  'next-main-phase': { kind: 'until', at: 'main-start' },
  'next-combat': { kind: 'until', at: 'combat-start' },
  'next-combat-phase': { kind: 'until', at: 'combat-start' },
  'next-time-this-turn': { kind: 'until', at: 'turn-end' },
  'next-qualifying-play': { kind: 'until', at: 'turn-end' },
};

export function delayedDuration(value: unknown): DelayedDuration | undefined {
  if (typeof value === 'string') return DELAYED_DURATION_ALIASES[value];
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Readonly<Record<string, unknown>>;
    if (record.kind === 'this-turn') return { kind: 'this-turn' };
    if (record.kind === 'until' && isTimingPointId(record.at)) {
      return { kind: 'until', at: record.at };
    }
  }
  return undefined;
}

/**
 * The registration's expiry timing point, if the window ends at one. The
 * pipeline removes registrations on their expiry wave after that wave's scan,
 * so an until-window keyed to the window-opening timing point still observes
 * the opening itself and is then removed.
 */
export function delayedExpiresAt(duration: DelayedDuration | undefined): TimingPointId | undefined {
  if (duration === undefined || duration.kind === 'this-turn') {
    return duration === undefined ? undefined : DELAYED_EXPIRES_AT;
  }
  return duration.at;
}

import type { ContinuousEffectSpec, Duration, ObjectSnapshot, PlayerId } from "../effects/contract.js";
import type { TimingPointId } from "../events/timing-points.js";
import { getTimingPoint, isTimingPointId } from "../events/timing-points.js";
import { refKey, sameRef, type RegisteredContinuousEffect, type TimingEvent } from "./types.js";

function assertDuration(duration: Duration): void {
  if (duration.type === "until" && !isTimingPointId(duration.at)) {
    throw new RangeError(`Unknown duration timing point: ${duration.at}`);
  }
}

function durationMatches(duration: Duration, event: TimingEvent): boolean {
  switch (duration.type) {
    case "permanent":
      return false;
    case "end-of-turn":
      return event.id === "turn-end";
    case "end-of-combat":
      return event.id === "combat-end";
    case "until":
      return duration.at === event.id && (duration.player === undefined || duration.player === event.player);
    case "while-source-in-zone":
      return false;
  }
}

export function isDurationActive(
  duration: Duration,
  event: TimingEvent | undefined,
  object: (ref: RegisteredContinuousEffect["effect"]["source"]) => ObjectSnapshot | null,
): boolean {
  assertDuration(duration);
  if (duration.type === "while-source-in-zone") {
    return duration.source !== undefined && object(duration.source) !== null;
  }
  return event === undefined || !durationMatches(duration, event);
}

export function durationExpiryTiming(duration: Duration): TimingPointId | null {
  switch (duration.type) {
    case "end-of-turn": return "turn-end";
    case "end-of-combat": return "combat-end";
    case "until": return duration.at;
    case "permanent":
    case "while-source-in-zone": return null;
  }
}

/** Ordered registry used by the layer engine and ResolveContext adapters. */
export class ContinuousEffectRegistry {
  private readonly entries = new Map<string, RegisteredContinuousEffect>();
  private nextSequence = 1;

  register(effect: ContinuousEffectSpec, duration: Duration, timestamp = this.nextSequence): RegisteredContinuousEffect {
    if (!effect || typeof effect.id !== "string" || effect.id.length === 0) {
      throw new TypeError("Continuous effects require a non-empty id");
    }
    if (this.entries.has(effect.id)) throw new Error(`Continuous effect already registered: ${effect.id}`);
    assertDuration(duration);
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new RangeError("timestamp must be a non-negative safe integer");
    const entry = Object.freeze({ effect, duration, timestamp, sequence: this.nextSequence++ });
    this.entries.set(effect.id, entry);
    return entry;
  }

  add(effect: ContinuousEffectSpec, duration: Duration, timestamp?: number): RegisteredContinuousEffect {
    return this.register(effect, duration, timestamp);
  }

  remove(id: string): boolean {
    return this.entries.delete(id);
  }

  clear(): void {
    this.entries.clear();
  }

  get(id: string): RegisteredContinuousEffect | undefined {
    return this.entries.get(id);
  }

  list(): readonly RegisteredContinuousEffect[] {
    return Object.freeze([...this.entries.values()].sort((left, right) =>
      left.timestamp - right.timestamp || left.sequence - right.sequence));
  }

  active(
    event: TimingEvent | undefined,
    object: (ref: RegisteredContinuousEffect["effect"]["source"]) => ObjectSnapshot | null,
  ): readonly RegisteredContinuousEffect[] {
    return Object.freeze(this.list().filter(entry => isDurationActive(entry.duration, event, object)));
  }

  expireAt(
    event: TimingEvent,
    object: (ref: RegisteredContinuousEffect["effect"]["source"]) => ObjectSnapshot | null,
  ): readonly string[] {
    const expired: string[] = [];
    for (const entry of this.list()) {
      if (entry.duration.type === "while-source-in-zone" || entry.duration.type === "permanent") continue;
      if (durationMatches(entry.duration, event)) {
        this.entries.delete(entry.effect.id);
        expired.push(entry.effect.id);
      }
    }
    return Object.freeze(expired);
  }

  expireInactive(object: (ref: RegisteredContinuousEffect["effect"]["source"]) => ObjectSnapshot | null): readonly string[] {
    const expired: string[] = [];
    for (const entry of this.list()) {
      if (entry.duration.type === "while-source-in-zone" && !isDurationActive(entry.duration, undefined, object)) {
        this.entries.delete(entry.effect.id);
        expired.push(entry.effect.id);
      }
    }
    return Object.freeze(expired);
  }

  snapshot(): readonly RegisteredContinuousEffect[] {
    return this.list();
  }
}

export function createContinuousEffectRegistry(
  entries: readonly { readonly effect: ContinuousEffectSpec; readonly duration: Duration; readonly timestamp?: number }[] = [],
): ContinuousEffectRegistry {
  const registry = new ContinuousEffectRegistry();
  for (const entry of entries) registry.register(entry.effect, entry.duration, entry.timestamp);
  return registry;
}

export function expireContinuousEffectsAt(
  registry: ContinuousEffectRegistry,
  timingPoint: TimingPointId,
  object: (ref: RegisteredContinuousEffect["effect"]["source"]) => ObjectSnapshot | null,
  player?: PlayerId,
): readonly string[] {
  getTimingPoint(timingPoint);
  return registry.expireAt({ id: timingPoint, player }, object);
}

export function continuousEffectId(entry: RegisteredContinuousEffect): string {
  return `${entry.effect.id}@${entry.timestamp}:${entry.sequence}`;
}

export function sourceIsLive(
  source: RegisteredContinuousEffect["effect"]["source"],
  objects: readonly ObjectSnapshot[],
): boolean {
  if (source === undefined) return false;
  return objects.some(object => sameRef(object.ref, source));
}

export { refKey };

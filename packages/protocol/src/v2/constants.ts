/**
 * Protocol v2 is the wire boundary for the P0 engine layers.  It is kept in
 * its own namespace so that the historical duel profiles remain byte-for-byte
 * compatible with their existing consumers.
 */
export const PROTOCOL_V2_VERSION = "2.0.0" as const;
export const PROTOCOL_VERSION_V2 = PROTOCOL_V2_VERSION;
export const V2_PROTOCOL_VERSION = PROTOCOL_V2_VERSION;
export const PROTOCOL_V2_SCHEMA_VERSION = 2 as const;
export const V2_SCHEMA_VERSION = PROTOCOL_V2_SCHEMA_VERSION;
export type ProtocolV2Version = typeof PROTOCOL_V2_VERSION;

export const PROTOCOL_V2_COMMAND_CONTRACT = "riftbound.protocol.v2.command" as const;
export const PROTOCOL_V2_EVENT_CONTRACT = "riftbound.protocol.v2.event" as const;
export const PROTOCOL_V2_PROJECTION_CONTRACT = "riftbound.protocol.v2.projection" as const;
export const V2_COMMAND_CONTRACT = PROTOCOL_V2_COMMAND_CONTRACT;
export const V2_EVENT_CONTRACT = PROTOCOL_V2_EVENT_CONTRACT;
export const V2_PROJECTION_CONTRACT = PROTOCOL_V2_PROJECTION_CONTRACT;

export const PROTOCOL_V2_RULESET_VERSION = "core-1.5" as const;
export const PROTOCOL_V2_JOURNAL_FORMAT = "riftbound-journal" as const;
export const PROTOCOL_V2_JOURNAL_VERSION = 1 as const;

export const V2_VISIBILITY_LEVELS = ["public", "owner-only", "hidden"] as const;
export type V2VisibilityLevel = (typeof V2_VISIBILITY_LEVELS)[number];

export const V2_ZONES = [
  "base", "board", "battlefield", "champion", "legend", "rune-zone",
  "hand", "deck", "rune-deck", "trash", "banishment", "chain", "facedown"
] as const;
export type V2Zone = (typeof V2_ZONES)[number];

export const V2_PHASES = [
  "setup", "awaken", "beginning", "channel", "draw", "main", "combat",
  "ending", "expiration", "ended"
] as const;
export type V2Phase = (typeof V2_PHASES)[number];

/** Closed list copied from engine-core/events/timing-points.ts. */
export const V2_TIMING_POINT_IDS = [
  "turn-start", "awaken-start", "awaken-end", "beginning-start", "beginning-end",
  "channel-start", "channel-end", "draw-start", "draw-end", "main-start", "main-end",
  "turn-end", "cleanup-start", "cleanup-end", "object-enters-zone", "object-leaves-zone",
  "object-enters-board", "object-leaves-board", "object-enters-battlefield",
  "object-leaves-battlefield", "object-enters-base", "object-leaves-base",
  "object-enters-deck", "object-leaves-deck", "object-enters-hand", "object-leaves-hand",
  "object-enters-rune-deck", "object-leaves-rune-deck", "object-enters-rune-zone",
  "object-leaves-rune-zone", "object-enters-trash", "object-leaves-trash",
  "object-enters-banishment", "object-leaves-banishment", "object-enters-chain",
  "object-leaves-chain", "card-played", "became-target", "object-killed", "object-readied",
  "object-exhausted", "attack-declared", "defense-declared", "showdown-open",
  "combat-damage-before", "combat-damage-after", "showdown-close", "combat-end",
  "chain-item-pending", "chain-item-finalize", "chain-item-resolve", "control-established",
  "control-lost", "conquer", "hold", "score", "final-point", "object-moved", "card-drawn",
  "card-discarded", "damage-dealt", "unit-stunned", "xp-gained", "buff-added", "buff-spent",
  "empowered-changed", "contested-applied", "contested-removed", "card-recycled",
  "card-banished", "card-revealed", "objects-shown-off", "card-hidden", "card-burned",
  "cards-looked-at", "object-attached", "might-changed", "ability-activated", "combat-start",
  "combat-result", "points-gained"
] as const;
export type V2TimingPointId = (typeof V2_TIMING_POINT_IDS)[number];

export function isV2TimingPointId(value: unknown): value is V2TimingPointId {
  return typeof value === "string" &&
    (V2_TIMING_POINT_IDS as readonly string[]).includes(value);
}

export function isV2Zone(value: unknown): value is V2Zone {
  return typeof value === "string" && (V2_ZONES as readonly string[]).includes(value);
}

export function isV2Phase(value: unknown): value is V2Phase {
  return typeof value === "string" && (V2_PHASES as readonly string[]).includes(value);
}

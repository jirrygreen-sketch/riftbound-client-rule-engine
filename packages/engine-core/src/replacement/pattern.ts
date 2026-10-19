import { matchesObjectFilter } from "../layers/filter.js";
import type {
  GameAction,
  ObjectFilter,
  ObjectRef,
  ObjectSnapshot,
  PlayerId
} from "../effects/contract.js";

/** Which side of a GameAction an EventPattern inspects. */
export interface PatternTarget {
  readonly object?: ObjectRef;
  readonly player?: PlayerId;
}

const refKey = (ref: ObjectRef): string => JSON.stringify([ref.id, ref.zoneEntryId]);

const sameRef = (left: ObjectRef | undefined, right: ObjectRef): boolean =>
  left !== undefined && left.id === right.id && left.zoneEntryId === right.zoneEntryId;

/** Closed map of card event kinds onto the pipeline GameAction set. */
const ACTION_KINDS: Readonly<Record<string, readonly GameAction["type"][]>> = {
  "object-enters-board": ["move-zone"],
  "object-killed": ["kill"],
  "object-readied": ["ready"],
  "object-exhausted": ["exhaust"],
  damage: ["damage"],
  score: ["score"],
  "card-played": ["play"],
  "card-revealed": ["reveal"],
  "object-enters-zone": ["move-zone", "return-to-hand", "recycle", "banish", "discard"],
  "object-leaves-chain": ["move-zone", "banish"],
  "object-leaves-zone": ["move-zone", "move-location", "return-to-hand", "recycle", "banish", "kill"]
};

/** The action ref an EventPattern object filter inspects. */
export function actionObjectRef(action: GameAction): ObjectRef | undefined {
  if ("object" in action) return action.object;
  if ("target" in action) return action.target;
  return undefined;
}

export interface PatternMatchInput {
  readonly pattern: Readonly<Record<string, unknown>>;
  readonly action: GameAction;
  readonly target: PatternTarget;
  readonly hostRef: ObjectRef;
  readonly controller: PlayerId;
  /** Snapshot for a ref, optionally the post-action orientation. */
  snapshotFor(ref: ObjectRef, after?: boolean): ObjectSnapshot | null;
}

/**
 * Card-side object filter matching. Card data mixes selector vocabulary
 * (self / other / source / target / objectId: "self"), which is normalized
 * here before the layers filter runs.
 */
export function filterMatchesSnapshot(
  filter: Readonly<Record<string, unknown>> | undefined,
  snapshot: ObjectSnapshot,
  ref: ObjectRef,
  hostRef: ObjectRef,
  controller: PlayerId
): boolean {
  if (!filter || Object.keys(filter).length === 0) return true;
  const normalized: Record<string, unknown> = {};
  const states: unknown[] = [];
  for (const [key, value] of Object.entries(filter)) {
    if (key === "zoneEntryId" && value !== ref.zoneEntryId) return false;
    if (key === "exhausted" && typeof value === "boolean") {
      if (value) states.push("exhausted");
      else states.push("ready");
      continue;
    }
    if (key === "ready" && value === true) {
      states.push("ready");
      continue;
    }
    if (key === "self") {
      if (value === true && !sameRef(ref, hostRef)) return false;
      continue;
    }
    if (key === "other") {
      if (value === true && sameRef(ref, hostRef)) return false;
      continue;
    }
    if ((key === "source" || key === "target") && (value === "self" || value === "source")) {
      if (!sameRef(ref, hostRef)) return false;
      continue;
    }
    if (key === "object" && typeof value === "object" && value !== null && (value as { objectId?: unknown }).objectId === "self") {
      const rest = { ...(value as Record<string, unknown>) };
      rest.objectId = ref.id;
      if (!filterMatchesSnapshot(rest, snapshot, ref, hostRef, controller)) return false;
      continue;
    }
    if ((key === "controller" || key === "owner") && (value === "self" || value === "controller" || value === "opponent")) {
      const actual = key === "controller" ? snapshot.controller : snapshot.owner;
      if (value === "opponent" ? actual === controller : actual !== controller) return false;
      continue;
    }
    normalized[key] = value;
  }
  if (states.length) normalized.states = states;
  return matchesObjectFilter(normalized as ObjectFilter, snapshot as never);
}

/**
 * Card-side EventPattern matching over the pipeline closed GameAction set.
 * Unknown event kinds never match. Readied/exhausted patterns never match a
 * chain-zone state action: those belong to the entry path (CR 805.6), while
 * board orientations still match (CR 370.1.a state-change events). Entry
 * filters see the post-move orientation, so a filter on the entering state
 * describes the event the ability replaces (CR 370.1.b).
 */
export function actionMatchesEventPattern(input: PatternMatchInput): boolean {
  const { pattern, action, target, hostRef, controller } = input;
  const kind = pattern.event ?? pattern.type ?? pattern.kind;
  const actionTypes = typeof kind === "string" ? ACTION_KINDS[kind] : undefined;
  if (!actionTypes || !actionTypes.includes(action.type)) return false;
  if (kind === "object-enters-board" && (action.type !== "move-zone" || (action.to !== "base" && action.to !== "battlefield"))) return false;
  if (kind === "object-leaves-chain" &&
      (action.type !== "move-zone" || ("object" in action && input.snapshotFor(action.object)?.zone !== "chain"))) return false;
  if (kind === "object-leaves-zone" &&
      (action.type === "kill" || action.type === "banish" || action.type === "recycle" ||
       action.type === "return-to-hand" || action.type === "move-zone" || action.type === "move-location")) {
    const ref = target.object ?? actionObjectRef(action);
    const snapshot = ref ? input.snapshotFor(ref) : null;
    if (snapshot === null) return false;
    const fromZone = pattern.fromZone;
    if (fromZone !== undefined) {
      const zones = Array.isArray(fromZone) ? fromZone : [fromZone];
      if (!zones.includes(snapshot.zone)) return false;
    }
  }
  const notFromZone = pattern.notFromZone;
  if (notFromZone !== undefined && (action.type === "kill" || action.type === "banish" || action.type === "recycle" ||
      action.type === "return-to-hand" || action.type === "move-zone" || action.type === "move-location")) {
    const ref = target.object ?? actionObjectRef(action);
    const snapshot = ref ? input.snapshotFor(ref) : null;
    if (snapshot === null) return false;
    const excluded = Array.isArray(notFromZone) ? notFromZone : [notFromZone];
    if (excluded.includes(snapshot.zone)) return false;
  }
  const toZone = pattern.toZone;
  if (toZone !== undefined && (kind === "object-enters-zone" || kind === "object-leaves-zone")) {
    if (action.type === "move-zone") {
      const zones = Array.isArray(toZone) ? toZone : [toZone];
      if (!zones.includes(action.to === "deck-bottom" ? "deck" : action.to === "deck-top" ? "deck" : action.to)) return false;
    } else if (action.type === "return-to-hand") {
      if (!(Array.isArray(toZone) ? toZone : [toZone]).includes("hand")) return false;
    } else if (action.type === "recycle") {
      if (!(Array.isArray(toZone) ? toZone : [toZone]).includes("deck")) return false;
    } else if (action.type === "banish") {
      if (!(Array.isArray(toZone) ? toZone : [toZone]).includes("banishment")) return false;
    } else if (action.type === "discard" || action.type === "kill") {
      if (!(Array.isArray(toZone) ? toZone : [toZone]).includes("trash")) return false;
    }
  }
  const filter = pattern.filter as Readonly<Record<string, unknown>> | undefined;
  const objectFilter = pattern.object as Readonly<Record<string, unknown>> | undefined;
  const entry = kind === "object-enters-board";
  if (entry) {
    const ref = target.object ?? actionObjectRef(action);
    if (!ref) return false;
    const snapshot = input.snapshotFor(ref, true);
    if (!snapshot) return false;
    return [filter, objectFilter].every(candidate =>
      candidate === undefined ||
      filterMatchesSnapshot(candidate, snapshot, ref, hostRef, controller)
    );
  }
  const ref = target.object ?? actionObjectRef(action);
  const snapshot = ref ? input.snapshotFor(ref) : null;
  if ((kind === "object-readied" || kind === "object-exhausted") && (!snapshot || snapshot.zone === "chain")) return false;
  if (ref && snapshot) {
    return [filter, objectFilter].every(candidate =>
      candidate === undefined ||
      filterMatchesSnapshot(candidate, snapshot, ref, hostRef, controller)
    );
  }
  if (ref || !snapshot) {
    // Player-anchored kinds (score) may match without an object; object
    // kinds without a live snapshot do not match.
    if (kind !== "score") return false;
  }
  const player = target.player ?? ("player" in action ? action.player : undefined);
  const selector = pattern.player;
  if (selector === "self") return player === controller;
  return selector === undefined || selector === "any";
}

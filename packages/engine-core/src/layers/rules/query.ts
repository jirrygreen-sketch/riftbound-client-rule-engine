/**
 * Rule queries over registered rule-modifying continuous effects.
 *
 * The registry contains the raw ability-layer registrations. These helpers
 * normalize both instruction and keyword expansion kinds, then apply the
 * registered object filter and zone-bound target identity before exposing a
 * rule result.
 */
import type { ObjectRef } from "@riftbound/card-dsl";
import type { ContinuousEffectRegistry } from "../duration.js";
import type { RegisteredContinuousEffect } from "../types.js";
import type { ObjectSnapshot, PlayerId } from "../../effects/contract.js";
import type {
  CanActInput,
  DeckLimit,
  GameActionName,
  RuleAppliedCostQuery,
  RuleLocationPermission,
  RuleLocationRestriction,
  RulePermissionQuery,
  RuleRequirementQuery,
  RuleRestrictionQuery,
} from "./types.js";

type AnyRecord = Record<string, unknown>;

function record(value: unknown): AnyRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as AnyRecord : {};
}

function asStringList(value: unknown): readonly string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  return typeof value === "string" ? [value] : [];
}

function sameRef(left: unknown, right: ObjectRef): boolean {
  return typeof left === "object" && left !== null &&
    (left as AnyRecord).id === right.id && (left as AnyRecord).zoneEntryId === right.zoneEntryId;
}

function refs(value: unknown): readonly ObjectRef[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is ObjectRef =>
    typeof item === "object" && item !== null && typeof (item as AnyRecord).id === "string" &&
    typeof (item as AnyRecord).zoneEntryId === "number"
  );
}

function effectKind(entry: RegisteredContinuousEffect): string {
  return String(record(entry.effect.effect).kind ?? "").toLowerCase();
}

/** Entries matching both legacy instruction kinds and keyword expansion kinds. */
function effectsOfKind(
  registry: ContinuousEffectRegistry,
  ...kinds: readonly string[]
): readonly RegisteredContinuousEffect[] {
  return registry.list().filter(entry => {
    const actual = effectKind(entry);
    return kinds.some(kind => actual === kind || actual === "continuous." + kind || actual.endsWith("." + kind));
  });
}

function listValue(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : value === undefined ? [] : [value];
}

function scalarMatches(expected: unknown, actual: unknown, relativePlayer?: PlayerId): boolean {
  if (expected === undefined || expected === "any") return true;
  if (expected === "self") return actual === relativePlayer;
  if (expected === "opponent") return relativePlayer !== undefined && actual !== relativePlayer;
  if (typeof expected === "object" && expected !== null && "playerId" in expected) {
    return (expected as AnyRecord).playerId === actual;
  }
  return Array.isArray(expected) ? expected.includes(actual) : expected === actual;
}

function objectFilterMatches(filter: AnyRecord, object: ObjectSnapshot, relativePlayer?: PlayerId): boolean {
  const objectId = filter.objectId ?? filter.id;
  if (objectId !== undefined && !scalarMatches(objectId, object.ref.id, relativePlayer)) return false;
  const zoneEntryId = filter.zoneEntryId;
  if (zoneEntryId !== undefined && !scalarMatches(zoneEntryId, object.ref.zoneEntryId, relativePlayer)) return false;
  if (!scalarMatches(filter.cardId ?? filter.canonicalCardId, object.cardId, relativePlayer)) return false;
  if (!scalarMatches(filter.controller, object.controller, relativePlayer)) return false;
  if (!scalarMatches(filter.owner, object.owner, relativePlayer)) return false;
  if (!scalarMatches(filter.zone, object.zone, relativePlayer)) return false;
  if (filter.type !== undefined || filter.types !== undefined) {
    const expected = listValue(filter.type ?? filter.types).map(String);
    if (!expected.some(item => item === "object" || object.types.includes(item))) return false;
  }
  if (filter.tag !== undefined || filter.tags !== undefined) {
    const expected = listValue(filter.tag ?? filter.tags).map(String);
    if (!expected.every(item => object.tags.includes(item))) return false;
  }
  if (filter.states !== undefined || filter.state !== undefined) {
    const states = listValue(filter.states ?? filter.state);
    if (!states.every(state => state === "ready" ? !object.exhausted : state === "exhausted" ? object.exhausted :
      state === "stunned" ? object.stunned : state === "attached" ? object.attachedTo !== null :
      state === "face-down" ? object.faceDown : false)) return false;
  }
  if (filter.location !== undefined && JSON.stringify(filter.location) !== JSON.stringify(object.location) &&
      !(typeof filter.location === "string" && object.location?.type === filter.location)) return false;
  const characteristics = record(filter.characteristics);
  for (const [key, expected] of Object.entries(characteristics)) {
    const actual = (object as unknown as AnyRecord)[key];
    if (!scalarMatches(expected, actual, relativePlayer)) return false;
  }
  return true;
}

/**
 * A caller asking about one object must provide a snapshot when the filter
 * contains fields beyond objectId. Failing closed avoids granting a
 * controller/zone/type-specific effect to an object whose characteristics
 * were never checked.
 */
function appliesTo(
  entry: RegisteredContinuousEffect,
  ref?: ObjectRef,
  object?: ObjectSnapshot | null,
  relativePlayer?: PlayerId,
): boolean {
  const effect = record(entry.effect.effect);
  const targetRefs = refs(effect.targetRefs ?? effect.targets);
  if (ref !== undefined && targetRefs.length > 0 && !targetRefs.some(target => sameRef(target, ref))) return false;
  if (ref === undefined) return true;
  const filter = record(entry.effect.filter);
  const targetObjects = refs(filter.objectRefs ?? filter.targetRefs);
  if (targetObjects.length > 0 && !targetObjects.some(target => sameRef(target, ref))) return false;
  const hasRichFilter = Object.keys(filter).some(key => !["objectId", "id", "zoneEntryId", "objectRefs", "targetRefs"].includes(key));
  if (object === undefined || object === null) {
    if (hasRichFilter) return false;
    const objectId = filter.objectId ?? filter.id;
    const ids = Array.isArray(objectId) ? objectId : objectId === undefined ? [] : [objectId];
    return ids.length === 0 || ids.includes(ref.id);
  }
  return objectFilterMatches(filter, object, relativePlayer);
}

function grantsFor(entry: RegisteredContinuousEffect): readonly string[] {
  const effect = record(entry.effect.effect);
  return [...asStringList(effect.grants), ...asStringList(effect.timings)];
}

/** All speed grants that apply to the given object ref. */
export function actionTimings(
  registry: ContinuousEffectRegistry,
  ref?: ObjectRef,
  object?: ObjectSnapshot | null,
  relativePlayer?: PlayerId,
): readonly string[] {
  const timings = new Set<string>();
  for (const entry of effectsOfKind(registry, "timing")) {
    if (!appliesTo(entry, ref, object, relativePlayer)) continue;
    for (const grant of grantsFor(entry)) timings.add(grant);
  }
  return Object.freeze([...timings]);
}

function timingAllowsSpeed(timings: readonly string[], speed: CanActInput["speed"]): boolean {
  if (speed === "normal") return true;
  const values = new Set(timings.map(value => value.toLowerCase()));
  if (speed === "action") return values.has("action") || values.has("showdown") || values.has("reaction");
  return values.has("reaction") || values.has("closed-state");
}

/**
 * Standalone play-activation check (CR v1.5 308-313, 806.2, 813.1.b).
 * The optional registry consumes Action/Reaction grants; without it this
 * remains the timing truth table used by the chain adapter.
 */
export function canAct(input: CanActInput): boolean;
export function canAct(registry: ContinuousEffectRegistry, input: CanActInput): boolean;
export function canAct(first: CanActInput | ContinuousEffectRegistry, second?: CanActInput): boolean {
  const input: CanActInput = second === undefined ? first as CanActInput : { ...second, registry: second.registry ?? first as ContinuousEffectRegistry };
  if (input.priorityHolder !== input.player) return false;
  const directTimings = input.grants ?? input.timings;
  const availableTimings = input.registry === undefined ? directTimings :
    actionTimings(input.registry, input.ref, input.object, input.player);
  if (availableTimings !== undefined && !timingAllowsSpeed(availableTimings, input.speed)) return false;
  if (input.speed === "normal") {
    return !input.showdown && !input.closedState && input.turnPlayer === input.player;
  }
  if (input.closedState) return input.speed === "reaction";
  if (input.showdown) return input.focusHolder === input.player;
  if (input.turnPlayer !== input.player) return false;
  if (input.speed === "reaction") return input.chainDepth === undefined || input.chainDepth === 0;
  return input.speed === "action";
}

/** Raw movement permissions recorded by continuous.movement effects. */
export function movement(
  registry: ContinuousEffectRegistry,
  ref?: ObjectRef,
  object?: ObjectSnapshot | null,
  relativePlayer?: PlayerId,
): {
  readonly allowed: boolean;
  readonly canMove: boolean;
  readonly canGank: boolean;
  readonly battlefieldToBattlefield: boolean;
  readonly restrictions: readonly string[];
  readonly permissions: readonly RulePermissionQuery[];
} {
  const permissions: RulePermissionQuery[] = [];
  const restrictions = new Set<string>();
  for (const entry of effectsOfKind(registry, "movement")) {
    if (!appliesTo(entry, ref, object, relativePlayer)) continue;
    const effect = record(entry.effect.effect);
    const permission = record(effect.permission);
    const routes = asStringList(permission.routes);
    if (routes.length > 0) {
      permissions.push({
        kind: "permission",
        routes,
        ...(permission.move === undefined ? {} : { move: String(permission.move) }),
        ...(permission.source === undefined && permission.destination === undefined ? {} : {
          endpoints: {
            ...(permission.source === undefined ? {} : { source: String(permission.source) }),
            ...(permission.destination === undefined ? {} : { destination: String(permission.destination) }),
          },
        }),
        source: entry.effect.source ?? { id: "unknown", zoneEntryId: 0 },
        filter: entry.effect.filter as Readonly<Record<string, unknown>>,
      });
    }
    for (const name of asStringList(effect.restrictions)) restrictions.add(name);
  }
  const blockedRoutes = new Set(restrictions);
  const usablePermissions = permissions.filter(permission => !permission.routes.some(route => blockedRoutes.has(route)));
  const battlefieldToBattlefield = usablePermissions.some(permission => permission.routes.includes("battlefield-to-battlefield"));
  const blocked = restrictions.has("cannot-move") || restrictions.has("move") || restrictions.has("all-movement");
  return Object.freeze({
    allowed: !blocked,
    canMove: !blocked,
    canGank: battlefieldToBattlefield,
    battlefieldToBattlefield,
    restrictions: Object.freeze([...restrictions]),
    permissions: Object.freeze(usablePermissions),
  });
}

/** Prohibitions recorded by continuous.restrict, split by action name. */
export function restrictions(
  registry: ContinuousEffectRegistry,
  action: GameActionName,
  actor?: ObjectRef,
  object?: ObjectSnapshot | null,
  relativePlayer?: PlayerId,
): readonly RuleRestrictionQuery[] {
  const result: RuleRestrictionQuery[] = [];
  const cancellations = effectsOfKind(registry, "restriction").map(entry => ({ entry, effect: record(entry.effect.effect) }))
    .filter(item => item.effect.cancels === true);
  for (const entry of effectsOfKind(registry, "restriction")) {
    const effect = record(entry.effect.effect);
    if (effect.cancels === true) continue;
    if (!appliesTo(entry, actor, object, relativePlayer)) continue;
    const actions = asStringList(effect.actions);
    if (actions.length > 0 && !actions.includes(action)) continue;
    const name = effect.restriction === undefined ? undefined : String(effect.restriction);
    const cancelled = cancellations.some(({ entry: cancelEntry, effect: cancel }) => {
      if (!appliesTo(cancelEntry, actor, object, relativePlayer)) return false;
      const cancelActions = asStringList(cancel.actions);
      if (cancelActions.length > 0 && !cancelActions.includes(action)) return false;
      return cancel.restriction === undefined || String(cancel.restriction) === name;
    });
    if (cancelled) continue;
    result.push({
      kind: "restriction",
      actions,
      ...(name === undefined ? {} : { name }),
      ...(effect.cap === true ? { cap: true } : {}),
      ...(effect.amount === undefined ? {} : { amount: Number(effect.amount) }),
      ...(effect.cost === undefined ? {} : { cost: effect.cost }),
      source: entry.effect.source ?? { id: "unknown", zoneEntryId: 0 },
      filter: entry.effect.filter as Readonly<Record<string, unknown>>,
    });
  }
  return Object.freeze(result);
}

/** "must" obligations recorded by continuous.restrict mode "require". */
export function requirements(
  registry: ContinuousEffectRegistry,
  action: GameActionName,
  actor?: ObjectRef,
  object?: ObjectSnapshot | null,
  relativePlayer?: PlayerId,
): readonly RuleRequirementQuery[] {
  const result: RuleRequirementQuery[] = [];
  for (const entry of effectsOfKind(registry, "requirement")) {
    const effect = record(entry.effect.effect);
    if (!appliesTo(entry, actor, object, relativePlayer)) continue;
    const actions = asStringList(effect.actions);
    if (actions.length > 0 && !actions.includes(action)) continue;
    result.push({
      kind: "requirement",
      actions,
      ...(effect.restriction === undefined ? {} : { name: String(effect.restriction) }),
      source: entry.effect.source ?? { id: "unknown", zoneEntryId: 0 },
      filter: entry.effect.filter as Readonly<Record<string, unknown>>,
    });
  }
  return Object.freeze(result);
}

/** Applied-cost modifications recorded by continuous.restrict. */
export function appliedCosts(
  registry: ContinuousEffectRegistry,
  action: GameActionName,
  actor?: ObjectRef,
  object?: ObjectSnapshot | null,
  relativePlayer?: PlayerId,
): readonly RuleAppliedCostQuery[] {
  const result: RuleAppliedCostQuery[] = [];
  for (const entry of effectsOfKind(registry, "applied-cost")) {
    const effect = record(entry.effect.effect);
    if (!appliesTo(entry, actor, object, relativePlayer)) continue;
    const actions = asStringList(effect.actions);
    if (actions.length > 0 && !actions.includes(action)) continue;
    result.push({
      kind: "applied-cost",
      actions,
      cost: effect.cost ?? null,
      source: entry.effect.source ?? { id: "unknown", zoneEntryId: 0 },
      filter: entry.effect.filter as Readonly<Record<string, unknown>>,
    });
  }
  return Object.freeze(result);
}

/** Play-location permissions recorded by continuous.location effects. */
export function playLocations(
  registry: ContinuousEffectRegistry,
  ref?: ObjectRef,
  object?: ObjectSnapshot | null,
  relativePlayer?: PlayerId,
): {
  readonly permissions: readonly RuleLocationPermission[];
  readonly restrictions: readonly RuleLocationRestriction[];
} {
  const permissions: RuleLocationPermission[] = [];
  const restrictions: RuleLocationRestriction[] = [];
  for (const entry of effectsOfKind(registry, "location")) {
    if (!appliesTo(entry, ref, object, relativePlayer)) continue;
    const effect = record(entry.effect.effect);
    const base = {
      source: entry.effect.source ?? { id: "unknown", zoneEntryId: 0 },
      filter: entry.effect.filter as Readonly<Record<string, unknown>>,
    };
    if (typeof effect.permission === "string") permissions.push({ kind: "location", name: effect.permission, ...base });
    if (typeof effect.restriction === "string") restrictions.push({ kind: "location", name: effect.restriction, ...base });
  }
  return Object.freeze({ permissions: Object.freeze(permissions), restrictions: Object.freeze(restrictions) });
}

/** Deck-limit effects for a named card (CR v1.5 103.3). */
export function deckLimit(registry: ContinuousEffectRegistry, name: string): DeckLimit | null {
  let unlimited = false;
  let max: number | null = null;
  for (const entry of effectsOfKind(registry, "deck-limit")) {
    const effect = record(entry.effect.effect);
    const filterName = record(record(entry.effect.filter).characteristics).name;
    if (filterName !== undefined && filterName !== name) continue;
    if (effect.mode === "unlimited") unlimited = true;
    else if (effect.mode === "max" && typeof effect.amount === "number") {
      max = max === null ? effect.amount : Math.min(max, effect.amount);
    }
  }
  if (unlimited) return { mode: "unlimited" };
  if (max !== null) return { mode: "max", amount: max };
  return null;
}

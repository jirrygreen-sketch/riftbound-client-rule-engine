/**
 * Rule queries over registered rule-modifying continuous effects.
 *
 * These helpers read the ContinuousEffectRegistry directly (raw effects,
 * before object filters), so rule wiring can combine them with its own object
 * evaluation. Speed grants feed canAct; movement/location/deck queries expose
 * raw permissions and restrictions for chain, turn, and combat wiring.
 */
import type { ContinuousEffectRegistry } from "../duration.js";
import type { RegisteredContinuousEffect } from "../types.js";
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
  return typeof value === "object" && value !== null ? value as AnyRecord : {};
}
function asStringList(value: unknown): readonly string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  return typeof value === "string" ? [value] : [];
}

/** Entries whose effect kind is one of the given labels (prefix match). */
function effectsOfKind(
  registry: ContinuousEffectRegistry,
  ...kinds: readonly string[]
): readonly RegisteredContinuousEffect[] {
  return registry.list().filter(entry => kinds.some(kind => String(record(entry.effect.effect).kind).startsWith(kind)));
}

/** All speed grants that apply to the given object ref (CR v1.5 159.2). */
export function actionTimings(
  registry: ContinuousEffectRegistry,
  ref?: { readonly id: string; readonly zoneEntryId: number },
): readonly string[] {
  const timings = new Set<string>();
  for (const entry of effectsOfKind(registry, "timing")) {
    const effect = record(entry.effect.effect);
    if (ref !== undefined && entry.effect.filter.objectId !== undefined &&
        entry.effect.filter.objectId !== ref.id) continue;
    for (const grant of asStringList(effect.grants)) timings.add(grant);
    for (const grant of asStringList(effect.timings)) timings.add(grant);
  }
  return Object.freeze([...timings]);
}

/**
 * Standalone play-activation check (CR v1.5 308-313).
 *
 * This is the future chain-engine mapping, kept pure so tests can prove the
 * truth table before wiring. Reaction subsumes Action (813.1.b).
 */
export function canAct(input: CanActInput): boolean {
  if (input.priorityHolder !== input.player) return false;
  if (input.speed === "normal") {
    return !input.showdown && !input.closedState && input.turnPlayer === input.player;
  }
  const focusOk = !input.showdown || input.focusHolder === input.player;
  if (!focusOk) return false;
  if (input.closedState) return input.speed === "reaction";
  if (!input.showdown && !input.closedState && input.speed === "reaction" &&
      input.chainDepth !== undefined && input.chainDepth === 0) return true;
  if (input.showdown) return true;
  return false;
}

/** Raw movement permissions recorded by continuous.movement effects. */
export function movement(
  registry: ContinuousEffectRegistry,
  ref?: { readonly id: string; readonly zoneEntryId: number },
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
    const effect = record(entry.effect.effect);
    if (ref !== undefined && entry.effect.filter.objectId !== undefined &&
        entry.effect.filter.objectId !== ref.id) continue;
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
  const battlefieldToBattlefield = permissions.some(permission =>
    permission.routes.includes("battlefield-to-battlefield"));
  return Object.freeze({
    allowed: true,
    canMove: true,
    canGank: battlefieldToBattlefield,
    battlefieldToBattlefield,
    restrictions: Object.freeze([...restrictions]),
    permissions: Object.freeze(permissions),
  });
}

/** Prohibitions recorded by continuous.restrict, split by action name. */
export function restrictions(
  registry: ContinuousEffectRegistry,
  action: GameActionName,
  actor?: { readonly id: string; readonly zoneEntryId: number },
): readonly RuleRestrictionQuery[] {
  const result: RuleRestrictionQuery[] = [];
  for (const entry of effectsOfKind(registry, "restriction")) {
    const effect = record(entry.effect.effect);
    if (Array.isArray(effect.cancels)) continue;
    const actions = asStringList(effect.actions);
    if (actions.length > 0 && !actions.includes(action)) continue;
    if (actor !== undefined && entry.effect.filter.objectId !== undefined &&
        entry.effect.filter.objectId !== actor.id) continue;
    result.push({
      kind: "restriction",
      actions,
      ...(effect.restriction === undefined ? {} : { name: String(effect.restriction) }),
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
  actor?: { readonly id: string; readonly zoneEntryId: number },
): readonly RuleRequirementQuery[] {
  const result: RuleRequirementQuery[] = [];
  for (const entry of effectsOfKind(registry, "requirement")) {
    const effect = record(entry.effect.effect);
    const actions = asStringList(effect.actions);
    if (actions.length > 0 && !actions.includes(action)) continue;
    if (actor !== undefined && entry.effect.filter.objectId !== undefined &&
        entry.effect.filter.objectId !== actor.id) continue;
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
): readonly RuleAppliedCostQuery[] {
  const result: RuleAppliedCostQuery[] = [];
  for (const entry of effectsOfKind(registry, "applied-cost")) {
    const effect = record(entry.effect.effect);
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
): {
  readonly permissions: readonly RuleLocationPermission[];
  readonly restrictions: readonly RuleLocationRestriction[];
} {
  const permissions: RuleLocationPermission[] = [];
  const restrictions: RuleLocationRestriction[] = [];
  for (const entry of effectsOfKind(registry, "location")) {
    const effect = record(entry.effect.effect);
    const base = {
      source: entry.effect.source ?? { id: "unknown", zoneEntryId: 0 },
      filter: entry.effect.filter as Readonly<Record<string, unknown>>,
    };
    if (typeof effect.permission === "string") {
      permissions.push({ kind: "location", name: effect.permission, ...base });
    }
    if (typeof effect.restriction === "string") {
      restrictions.push({ kind: "location", name: effect.restriction, ...base });
    }
  }
  return Object.freeze({ permissions: Object.freeze(permissions), restrictions: Object.freeze(restrictions) });
}

/** Deck-limit effects for a named card (CR v1.5 103.3). */
export function deckLimit(
  registry: ContinuousEffectRegistry,
  name: string,
): DeckLimit | null {
  let unlimited = false;
  let max: number | null = null;
  for (const entry of effectsOfKind(registry, "deck-limit")) {
    const effect = record(entry.effect.effect);
    if (effect.mode === "unlimited") {
      const filterName = record((entry.effect.filter as AnyRecord).characteristics).name;
      if (filterName === undefined || filterName === name) unlimited = true;
    } else if (effect.mode === "max") {
      const filterName = record((entry.effect.filter as Record<string, unknown>).characteristics).name;
      if (filterName !== undefined && filterName !== name) continue;
      max = max === null ? Number(effect.amount) : Math.min(max, Number(effect.amount));
  }
  }
  if (unlimited) return { mode: "unlimited" };
  if (max !== null) return { mode: "max", amount: max };
  return null;
}

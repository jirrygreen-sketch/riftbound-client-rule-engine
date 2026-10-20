/**
 * Read-only consumers for rule-modifying continuous effects.
 *
 * The registry remains the single source of registrations.  This module only
 * normalizes a registration into a query result; it never mutates game state.
 * The legacy positional arguments are kept so existing chain/target/movement
 * callers continue to work, while the scope overload supplies a source,
 * affected object, and relative player together.
 */
import type { ObjectRef } from "@riftbound/card-dsl";
import type { ContinuousEffectRegistry } from "../duration.js";
import type { RegisteredContinuousEffect } from "../types.js";
import type { ObjectSnapshot, PlayerId } from "../../effects/contract.js";
import type {
  CanActInput,
  DeckLimit,
  GameActionName,
  RuleActionKind,
  RuleActionQuery,
  RuleAppliedCostQuery,
  RuleCombatQuery,
  RuleLocationPermission,
  RuleLocationRestriction,
  RulePermissionQuery,
  RuleQueryScope,
  RuleRequirementQuery,
  RuleResourceQuery,
  RuleRestrictionQuery,
  RuleUsageQuery,
  RuleUseScope,
} from "./types.js";

type AnyRecord = Record<string, unknown>;
type ScopeArg = ObjectRef | RuleQueryScope | undefined;
type QueryContext = {
  readonly ref?: ObjectRef;
  readonly object?: ObjectSnapshot | null;
  readonly source?: ObjectRef | ObjectSnapshot | null;
  readonly sourceObject?: ObjectSnapshot | null;
  readonly affected?: ObjectRef | ObjectSnapshot | null;
  readonly affectedObject?: ObjectSnapshot | null;
  readonly player?: PlayerId;
  readonly sourcePlayer?: PlayerId;
  readonly actionKind?: "play" | "activate";
  readonly action?: GameActionName;
};

const UNKNOWN_REF: ObjectRef = Object.freeze({ id: "unknown", zoneEntryId: 0 });
const KNOWN_COMBAT_FLAGS = new Set([
  "tank", "backline", "no-combat-damage", "damage-assignment", "assignment-priority",
  "lethal-first", "cannot-contribute", "combat-role",
]);
const KNOWN_RESOURCES = new Set(["energy", "power", "universal-power", "xp", "gold", "score"]);
const KNOWN_USE_SCOPES = new Set(["turn", "combat", "round", "game", "source", "player"]);

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

type LifecycleRuleRegistry = ContinuousEffectRegistry & {
  readonly lifecycleRuleEffects?: () => readonly RegisteredContinuousEffect[];
};

/** Explicit registrations remain public; lifecycle-derived entries stay queryable. */
function registeredEffects(registry: ContinuousEffectRegistry): readonly RegisteredContinuousEffect[] {
  return (registry as LifecycleRuleRegistry).lifecycleRuleEffects?.() ?? registry.list();
}

function effectsOfKind(
  registry: ContinuousEffectRegistry,
  ...kinds: readonly string[]
): readonly RegisteredContinuousEffect[] {
  return registeredEffects(registry).filter(entry => {
    const actual = effectKind(entry);
    return kinds.some(kind => actual === kind || actual === "continuous." + kind || actual.endsWith("." + kind));
  });
}

function listValue(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : value === undefined ? [] : [value];
}

function sourceRef(value: ObjectRef | ObjectSnapshot | null | undefined): ObjectRef | undefined {
  if (value === null || value === undefined) return undefined;
  return "ref" in value ? value.ref : value;
}

function snapshot(value: ObjectRef | ObjectSnapshot | null | undefined): ObjectSnapshot | undefined {
  return value !== null && value !== undefined && "ref" in value ? value : undefined;
}

function normalizeScope(
  refOrScope?: ScopeArg,
  object?: ObjectSnapshot | null,
  relativePlayer?: PlayerId,
  actionKind?: "play" | "activate",
): QueryContext {
  if (refOrScope !== undefined && "id" in refOrScope && "zoneEntryId" in refOrScope) {
    return { ref: refOrScope, object, player: relativePlayer, sourcePlayer: relativePlayer, actionKind };
  }
  const scope = refOrScope as RuleQueryScope | undefined;
  const affected = scope?.affected ?? scope?.object ?? object;
  const affectedObject = snapshot(affected) ?? object ?? undefined;
  const sourceObject = snapshot(scope?.source);
  const source = scope?.source;
  const player = scope?.player ?? relativePlayer;
  const sourcePlayer = scope?.sourcePlayer ?? sourceObject?.controller ?? player;
  return {
    ref: sourceRef(affected) ?? scope?.actor,
    object: affectedObject,
    source,
    sourceObject,
    affected,
    affectedObject,
    player,
    sourcePlayer,
    actionKind: scope?.actionKind ?? actionKind,
    action: scope?.action,
  };
}

function sourceOf(entry: RegisteredContinuousEffect, context: QueryContext): ObjectRef {
  return entry.effect.source ?? sourceRef(context.source) ?? UNKNOWN_REF;
}

function sourcePlayerOf(entry: RegisteredContinuousEffect, context: QueryContext): PlayerId | undefined {
  const effect = record(entry.effect.effect);
  return typeof effect.sourcePlayer === "string" ? effect.sourcePlayer :
    context.sourcePlayer ?? context.sourceObject?.controller;
}

function scalarMatches(
  expected: unknown,
  actual: unknown,
  relativePlayer?: PlayerId,
  sourcePlayer?: PlayerId,
  sourceAlias = false,
): boolean {
  if (expected === undefined || expected === "any") return true;
  if (expected === "self") return actual === relativePlayer;
  if (expected === "opponent") return relativePlayer !== undefined && actual !== relativePlayer;
  if (sourceAlias && (expected === "source" || expected === "source-player" || expected === "source-controller")) {
    return sourcePlayer !== undefined && actual === sourcePlayer;
  }
  if (typeof expected === "object" && expected !== null && "playerId" in expected) {
    return (expected as AnyRecord).playerId === actual;
  }
  return Array.isArray(expected) ? expected.includes(actual) : expected === actual;
}

function locationEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function objectFilterMatches(
  filter: AnyRecord,
  object: ObjectSnapshot,
  relativePlayer?: PlayerId,
  sourcePlayer?: PlayerId,
  sourceObject?: ObjectSnapshot | null,
  affectedObject?: ObjectSnapshot | null,
): boolean {
  const objectId = filter.objectId ?? filter.id;
  if (objectId !== undefined && !scalarMatches(objectId, object.ref.id, relativePlayer, sourcePlayer)) return false;
  const zoneEntryId = filter.zoneEntryId;
  if (zoneEntryId !== undefined && !scalarMatches(zoneEntryId, object.ref.zoneEntryId, relativePlayer, sourcePlayer)) return false;
  if (!scalarMatches(filter.cardId ?? filter.canonicalCardId, object.cardId, relativePlayer, sourcePlayer)) return false;
  if (!scalarMatches(filter.controller, object.controller, relativePlayer, sourcePlayer, true)) return false;
  if (!scalarMatches(filter.owner, object.owner, relativePlayer, sourcePlayer, true)) return false;
  if (!scalarMatches(filter.zone, object.zone, relativePlayer, sourcePlayer)) return false;
  if (filter.object !== undefined) {
    const relation = filter.object;
    if (relation === "self" || relation === "source") {
      if (sourceObject === undefined || sourceObject === null || !sameRef(sourceObject.ref, object.ref)) return false;
    } else if (relation === "affected") {
      if (affectedObject === undefined || affectedObject === null || !sameRef(affectedObject.ref, object.ref)) return false;
    } else if (relation !== "any") {
      return false;
    }
  }
  const source = filter.source ?? filter.sourceRef;
  if (source !== undefined) {
    const sourceIdentity = sourceRef(sourceObject);
    if (source === "self" || source === "source") {
      if (sourceObject === undefined || sourceObject === null || sourceIdentity === undefined) return false;
    } else if (sourceIdentity === undefined || !sameRef(source, sourceIdentity)) return false;
  }
  const affectedController = filter.affectedController;
  if (affectedController !== undefined) {
    if (affectedObject === undefined || affectedObject === null || !scalarMatches(affectedController, affectedObject.controller, relativePlayer, sourcePlayer, true)) return false;
  }
  const sameLocationAs = filter.sameLocationAs;
  if (sameLocationAs !== undefined) {
    const anchor = sameLocationAs === "source" || sameLocationAs === "self" ? sourceObject : affectedObject;
    if (anchor === undefined || anchor === null || !locationEqual(anchor.location, object.location)) return false;
  }
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
  if (filter.location !== undefined && !locationEqual(filter.location, object.location) &&
      !(typeof filter.location === "string" && object.location?.type === filter.location)) return false;
  const characteristics = record(filter.characteristics);
  for (const [key, expected] of Object.entries(characteristics)) {
    const actual = (object as unknown as AnyRecord)[key];
    if (!scalarMatches(expected, actual, relativePlayer, sourcePlayer)) return false;
  }
  return true;
}

function appliesTo(entry: RegisteredContinuousEffect, context: QueryContext): boolean {
  const effect = record(entry.effect.effect);
  const ref = context.ref;
  const targetRefs = refs(effect.targetRefs ?? effect.targets);
  if (ref !== undefined && targetRefs.length > 0 && !targetRefs.some(target => sameRef(target, ref))) return false;
  const filter = record(entry.effect.filter);
  const targetObjects = refs(filter.objectRefs ?? filter.targetRefs);
  if (ref !== undefined && targetObjects.length > 0 && !targetObjects.some(target => sameRef(target, ref))) return false;
  if (ref === undefined && context.object === undefined) {
    const hasObjectSpecific = Object.keys(filter).some(key => !["objectRefs", "targetRefs"].includes(key));
    return !hasObjectSpecific;
  }
  if (context.object === undefined || context.object === null) {
    const hasRichFilter = Object.keys(filter).some(key => !["objectId", "id", "zoneEntryId", "objectRefs", "targetRefs"].includes(key));
    if (hasRichFilter) return false;
    const objectId = filter.objectId ?? filter.id;
    const ids = Array.isArray(objectId) ? objectId : objectId === undefined ? [] : [objectId];
    return ref === undefined || ids.length === 0 || ids.includes(ref.id);
  }
  return objectFilterMatches(filter, context.object, context.player, context.sourcePlayer, context.sourceObject, context.affectedObject);
}

function actionKindOf(effect: AnyRecord): RuleActionKind | undefined {
  const value = effect.actionKind ?? (effect.scope === "play" || effect.scope === "activate" ? effect.scope : undefined);
  return typeof value === "string" ? value as RuleActionKind : undefined;
}

function actionMatches(effect: AnyRecord, action: GameActionName, requestedKind?: "play" | "activate"): boolean {
  const actions = asStringList(effect.actions ?? effect.action ?? effect.operation);
  const kind = actionKindOf(effect);
  if (requestedKind !== undefined && kind !== undefined && kind !== requestedKind) return false;
  if (actions.length === 0) return true;
  if (actions.includes(action)) return true;
  if (requestedKind === "play" && actions.some(value => value.startsWith("play-"))) return action === "play" || action.startsWith("play-");
  if (requestedKind === "activate" && actions.some(value => value.startsWith("activate") || value.includes("ability"))) {
    return action === "activate" || action.startsWith("activate") || action.includes("ability");
  }
  return false;
}

function normalizedActions(effect: AnyRecord): readonly string[] {
  return asStringList(effect.actions ?? effect.action ?? effect.operation);
}

function queryContext(
  refOrScope: ScopeArg,
  object: ObjectSnapshot | null | undefined,
  relativePlayer: PlayerId | undefined,
  actionKind?: "play" | "activate",
): QueryContext {
  return normalizeScope(refOrScope, object, relativePlayer, actionKind);
}

function querySource(entry: RegisteredContinuousEffect, context: QueryContext): ObjectRef {
  return sourceOf(entry, context);
}

function freeze<T>(value: readonly T[]): readonly T[] {
  return Object.freeze([...value]);
}

function grantsFor(entry: RegisteredContinuousEffect, requestedKind?: "play" | "activate"): readonly string[] {
  const effect = record(entry.effect.effect);
  const applies = asStringList(effect.appliesTo ?? effect.for);
  const declared = actionKindOf(effect);
  if (requestedKind !== undefined) {
    if (declared !== undefined && declared !== requestedKind) return [];
    if (applies.length > 0) {
      const accepted = requestedKind === "play"
        ? applies.some(value => ["card", "play", "played-card"].includes(value))
        : applies.some(value => ["activated-ability", "ability", "activate"].includes(value));
      if (!accepted && declared === undefined) return [];
    }
  }
  return [...asStringList(effect.grants), ...asStringList(effect.timings)];
}

/** All timing grants for an object, with play and activate scopes kept distinct. */
export function actionTimings(
  registry: ContinuousEffectRegistry,
  refOrScope?: ScopeArg,
  object?: ObjectSnapshot | null,
  relativePlayer?: PlayerId,
  actionKind?: "play" | "activate",
): readonly string[] {
  const context = queryContext(refOrScope, object, relativePlayer, actionKind);
  const timings = new Set<string>();
  for (const entry of effectsOfKind(registry, "timing")) {
    if (!appliesTo(entry, context)) continue;
    for (const grant of grantsFor(entry, context.actionKind)) timings.add(grant);
  }
  return freeze([...timings]);
}

function timingAllowsSpeed(timings: readonly string[], speed: CanActInput["speed"]): boolean {
  if (speed === "normal") return true;
  const values = new Set(timings.map(value => value.toLowerCase()));
  if (speed === "action") return values.has("action") || values.has("showdown") || values.has("reaction");
  return values.has("reaction") || values.has("closed-state");
}

export function canAct(input: CanActInput): boolean;
export function canAct(registry: ContinuousEffectRegistry, input: CanActInput): boolean;
export function canAct(first: CanActInput | ContinuousEffectRegistry, second?: CanActInput): boolean {
  const input: CanActInput = second === undefined ? first as CanActInput : {
    ...second, registry: second.registry ?? first as ContinuousEffectRegistry,
  };
  if (input.priorityHolder !== input.player) return false;
  const directTimings = input.grants ?? input.timings;
  const availableTimings = input.registry === undefined ? directTimings :
    actionTimings(input.registry, input.ref, input.object, input.player);
  if (input.registry !== undefined) {
    if (!timingAllowsSpeed(availableTimings ?? [], input.speed)) return false;
  } else if (availableTimings !== undefined && !timingAllowsSpeed(availableTimings, input.speed)) {
    return false;
  }
  if (input.speed === "normal") return !input.showdown && !input.closedState && input.turnPlayer === input.player;
  if (input.closedState) return input.speed === "reaction";
  if (input.showdown) return input.focusHolder === input.player;
  if (input.turnPlayer !== input.player) return false;
  if (input.speed === "reaction") return input.chainDepth === undefined || input.chainDepth === 0;
  return input.speed === "action";
}

/** Movement permissions, normalized to the same source/affected shape as other queries. */
export function movement(
  registry: ContinuousEffectRegistry,
  refOrScope?: ScopeArg,
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
  const context = queryContext(refOrScope, object, relativePlayer);
  const permissions: RulePermissionQuery[] = [];
  const restrictions = new Set<string>();
  for (const entry of effectsOfKind(registry, "movement")) {
    if (!appliesTo(entry, context)) continue;
    const effect = record(entry.effect.effect);
    const permission = record(effect.permission);
    const routes = asStringList(permission.routes);
    if (routes.length > 0) {
      permissions.push({
        kind: "permission", routes,
        ...(permission.move === undefined ? {} : { move: String(permission.move) }),
        ...(permission.source === undefined && permission.destination === undefined ? {} : {
          endpoints: {
            ...(permission.source === undefined ? {} : { source: String(permission.source) }),
            ...(permission.destination === undefined ? {} : { destination: String(permission.destination) }),
          },
        }),
        ...(normalizedActions(effect).length > 0 ? { actions: normalizedActions(effect) } : {}),
        ...(actionKindOf(effect) === undefined ? {} : { actionKind: actionKindOf(effect) }),
        ...(sourcePlayerOf(entry, context) === undefined ? {} : { sourcePlayer: sourcePlayerOf(entry, context) }),
        source: querySource(entry, context),
        filter: entry.effect.filter as Readonly<Record<string, unknown>>,
      });
    }
    for (const name of asStringList(effect.restrictions)) restrictions.add(name);
  }
  const blockedRoutes = new Set([...restrictions, ...[...restrictions].map(value => value.toLowerCase())]);
  const usablePermissions = permissions.filter(permission => !permission.routes.some(route =>
    blockedRoutes.has(route) || blockedRoutes.has(route.toLowerCase())));
  const battlefieldToBattlefield = usablePermissions.some(permission => permission.routes.includes("battlefield-to-battlefield"));
  const blocked = [...restrictions].some(name => ["cannot-move", "move", "all-movement"].includes(name.toLowerCase()));
  return Object.freeze({
    allowed: !blocked, canMove: !blocked, canGank: battlefieldToBattlefield,
    battlefieldToBattlefield, restrictions: freeze([...restrictions]), permissions: freeze(usablePermissions),
  });
}

function restrictionQuery(entry: RegisteredContinuousEffect, context: QueryContext, actions: readonly string[], name: string | undefined): RuleRestrictionQuery {
  const effect = record(entry.effect.effect);
  const sourcePlayer = sourcePlayerOf(entry, context);
  return {
    kind: "restriction", actions,
    ...(name === undefined ? {} : { name }),
    ...(effect.cap === true ? { cap: true } : {}),
    ...(typeof effect.amount === "number" ? { amount: effect.amount } : {}),
    ...(effect.cost === undefined ? {} : { cost: effect.cost }),
    ...(actionKindOf(effect) === undefined ? {} : { actionKind: actionKindOf(effect) }),
    ...(typeof effect.scope === "string" ? { scope: effect.scope as RuleUseScope } : {}),
    ...(sourcePlayer === undefined ? {} : { sourcePlayer }),
    source: querySource(entry, context),
    filter: entry.effect.filter as Readonly<Record<string, unknown>>,
    ...(context.ref === undefined ? {} : { affected: context.ref }),
  };
}

/** Prohibitions recorded by continuous.restrict, split by action and scope. */
export function restrictions(
  registry: ContinuousEffectRegistry,
  action: GameActionName,
  actorOrScope?: ScopeArg,
  object?: ObjectSnapshot | null,
  relativePlayer?: PlayerId,
): readonly RuleRestrictionQuery[] {
  const context = queryContext(actorOrScope, object, relativePlayer);
  const result: RuleRestrictionQuery[] = [];
  const cancellations = effectsOfKind(registry, "restriction").map(entry => ({ entry, effect: record(entry.effect.effect) }))
    .filter(item => item.effect.cancels === true);
  for (const entry of effectsOfKind(registry, "restriction")) {
    const effect = record(entry.effect.effect);
    if (effect.cancels === true || !appliesTo(entry, context)) continue;
    if (!actionMatches(effect, action, context.actionKind)) continue;
    const actions = normalizedActions(effect);
    const name = effect.restriction === undefined ? undefined : String(effect.restriction);
    const cancelled = cancellations.some(({ entry: cancelEntry, effect: cancel }) => {
      if (!appliesTo(cancelEntry, context) || !actionMatches(cancel, action, context.actionKind)) return false;
      const cancelName = cancel.restriction === undefined ? undefined : String(cancel.restriction);
      return cancelName === undefined || cancelName === name;
    });
    if (!cancelled) result.push(restrictionQuery(entry, context, actions, name));
  }
  return freeze(result);
}

export function requirements(
  registry: ContinuousEffectRegistry,
  action: GameActionName,
  actorOrScope?: ScopeArg,
  object?: ObjectSnapshot | null,
  relativePlayer?: PlayerId,
): readonly RuleRequirementQuery[] {
  const context = queryContext(actorOrScope, object, relativePlayer);
  const result: RuleRequirementQuery[] = [];
  for (const entry of effectsOfKind(registry, "requirement")) {
    const effect = record(entry.effect.effect);
    if (!appliesTo(entry, context) || !actionMatches(effect, action, context.actionKind)) continue;
    const actions = normalizedActions(effect);
    const sourcePlayer = sourcePlayerOf(entry, context);
    result.push({
      kind: "requirement", actions,
      ...(effect.restriction === undefined ? {} : { name: String(effect.restriction) }),
      ...(actionKindOf(effect) === undefined ? {} : { actionKind: actionKindOf(effect) }),
      ...(sourcePlayer === undefined ? {} : { sourcePlayer }),
      source: querySource(entry, context), filter: entry.effect.filter as Readonly<Record<string, unknown>>,
      ...(context.ref === undefined ? {} : { affected: context.ref }),
    });
  }
  return freeze(result);
}

export function appliedCosts(
  registry: ContinuousEffectRegistry,
  action: GameActionName,
  actorOrScope?: ScopeArg,
  object?: ObjectSnapshot | null,
  relativePlayer?: PlayerId,
): readonly RuleAppliedCostQuery[] {
  const context = queryContext(actorOrScope, object, relativePlayer);
  const result: RuleAppliedCostQuery[] = [];
  for (const entry of effectsOfKind(registry, "applied-cost")) {
    const effect = record(entry.effect.effect);
    if (!appliesTo(entry, context) || !actionMatches(effect, action, context.actionKind)) continue;
    const actions = normalizedActions(effect);
    const sourcePlayer = sourcePlayerOf(entry, context);
    result.push({
      kind: "applied-cost", actions, cost: effect.cost,
      ...(actionKindOf(effect) === undefined ? {} : { actionKind: actionKindOf(effect) }),
      ...(sourcePlayer === undefined ? {} : { sourcePlayer }),
      source: querySource(entry, context), filter: entry.effect.filter as Readonly<Record<string, unknown>>,
      ...(context.ref === undefined ? {} : { affected: context.ref }),
    });
  }
  return freeze(result);
}

export function playLocations(
  registry: ContinuousEffectRegistry,
  refOrScope?: ScopeArg,
  object?: ObjectSnapshot | null,
  relativePlayer?: PlayerId,
): { readonly permissions: readonly RuleLocationPermission[]; readonly restrictions: readonly RuleLocationRestriction[] } {
  const context = queryContext(refOrScope, object, relativePlayer, "play");
  const permissions: RuleLocationPermission[] = [];
  const restrictions: RuleLocationRestriction[] = [];
  for (const entry of effectsOfKind(registry, "location")) {
    if (!appliesTo(entry, context)) continue;
    const effect = record(entry.effect.effect);
    const base = {
      source: querySource(entry, context), filter: entry.effect.filter as Readonly<Record<string, unknown>>,
      ...(actionKindOf(effect) === undefined ? {} : { actionKind: actionKindOf(effect) }),
      ...(sourcePlayerOf(entry, context) === undefined ? {} : { sourcePlayer: sourcePlayerOf(entry, context) }),
    };
    if (typeof effect.permission === "string") permissions.push({ kind: "location", name: effect.permission, ...base });
    if (typeof effect.restriction === "string") restrictions.push({ kind: "location", name: effect.restriction, ...base });
  }
  return Object.freeze({ permissions: freeze(permissions), restrictions: freeze(restrictions) });
}

/** Unified permission view for movement, play-location, and explicit permission registrations. */
export function permissions(
  registry: ContinuousEffectRegistry,
  refOrScope?: ScopeArg,
  object?: ObjectSnapshot | null,
  relativePlayer?: PlayerId,
): readonly RulePermissionQuery[] {
  const context = queryContext(refOrScope, object, relativePlayer);
  const result: RulePermissionQuery[] = [...movement(registry, refOrScope, object, relativePlayer).permissions];
  for (const entry of effectsOfKind(registry, "permission")) {
    const effect = record(entry.effect.effect);
    if (!appliesTo(entry, context)) continue;
    const routes = asStringList(effect.routes ?? effect.permission ?? effect.permissions);
    if (routes.length === 0) continue;
    result.push({
      kind: "permission", routes, actions: normalizedActions(effect),
      ...(actionKindOf(effect) === undefined ? {} : { actionKind: actionKindOf(effect) }),
      ...(sourcePlayerOf(entry, context) === undefined ? {} : { sourcePlayer: sourcePlayerOf(entry, context) }),
      source: querySource(entry, context), filter: entry.effect.filter as Readonly<Record<string, unknown>>,
    });
  }
  return freeze(result);
}

/** Deck-limit effects for a named card (CR v1.5 103.3). */
export function deckLimit(registry: ContinuousEffectRegistry, name: string): DeckLimit | null {
  let unlimited = false;
  let max: number | null = null;
  for (const entry of effectsOfKind(registry, "deck-limit")) {
    const effect = record(entry.effect.effect);
    const filterName = record(record(entry.effect.filter).characteristics).name;
    const declaredName = effect.name;
    const scopedName = typeof filterName === "string" ? filterName : typeof declaredName === "string" ? declaredName : undefined;
    if (scopedName !== undefined && scopedName !== name) continue;
    if (effect.mode === "unlimited") unlimited = true;
    else if (effect.mode === "max" && typeof effect.amount === "number" && Number.isSafeInteger(effect.amount) && effect.amount >= 0) {
      max = max === null ? effect.amount : Math.min(max, effect.amount);
    }
  }
  if (unlimited) return { mode: "unlimited" };
  if (max !== null) return { mode: "max", amount: max };
  return null;
}

/** Normalized combat declarations. Unknown flags stay invisible to consumers. */
export function combatRules(
  registry: ContinuousEffectRegistry,
  refOrScope?: ScopeArg,
  object?: ObjectSnapshot | null,
  relativePlayer?: PlayerId,
): readonly RuleCombatQuery[] {
  const context = queryContext(refOrScope, object, relativePlayer);
  const result: RuleCombatQuery[] = [];
  for (const entry of effectsOfKind(registry, "combat")) {
    const effect = record(entry.effect.effect);
    if (!appliesTo(entry, context)) continue;
    const flags = asStringList(effect.flags ?? effect.rules ?? effect.requirements).filter(flag => KNOWN_COMBAT_FLAGS.has(flag));
    if (flags.length === 0) continue;
    result.push({
      kind: "combat", flags, source: querySource(entry, context),
      filter: entry.effect.filter as Readonly<Record<string, unknown>>,
      ...(context.ref === undefined ? {} : { affected: context.ref }),
      ...(sourcePlayerOf(entry, context) === undefined ? {} : { sourcePlayer: sourcePlayerOf(entry, context) }),
    });
  }
  return freeze(result);
}

/** Per-source ability-use caps. An unknown scope or non-numeric cap is ignored. */
export function abilityUses(
  registry: ContinuousEffectRegistry,
  refOrScope?: ScopeArg,
  object?: ObjectSnapshot | null,
  relativePlayer?: PlayerId,
): readonly RuleUsageQuery[] {
  const context = queryContext(refOrScope, object, relativePlayer, "activate");
  const result: RuleUsageQuery[] = [];
  for (const entry of effectsOfKind(registry, "ability-count", "usage", "restriction")) {
    const effect = record(entry.effect.effect);
    if (!appliesTo(entry, context)) continue;
    const amount = effect.limit ?? effect.maxUses ?? effect.amount;
    const scope = effect.scope ?? effect.window ?? "turn";
    if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount < 0 ||
        typeof scope !== "string" || !KNOWN_USE_SCOPES.has(scope)) continue;
    const actions = normalizedActions(effect);
    if (effectKind(entry) === "restriction" && effect.cap !== true) continue;
    result.push({
      kind: "ability-count", limit: amount, scope: scope as RuleUseScope,
      activator: effect.activator === "any-player" ? "any-player" : typeof effect.activator === "string" ? effect.activator : "controller",
      source: querySource(entry, context), filter: entry.effect.filter as Readonly<Record<string, unknown>>,
      ...(context.ref === undefined ? {} : { affected: context.ref }),
      ...(sourcePlayerOf(entry, context) === undefined ? {} : { sourcePlayer: sourcePlayerOf(entry, context) }),
    });
    void actions;
  }
  return freeze(result);
}

/** Resource additions/restrictions with null-safe amounts. */
export function resourceRules(
  registry: ContinuousEffectRegistry,
  resource?: string,
  refOrScope?: ScopeArg,
  object?: ObjectSnapshot | null,
  relativePlayer?: PlayerId,
): readonly RuleResourceQuery[] {
  const context = queryContext(refOrScope, object, relativePlayer);
  const result: RuleResourceQuery[] = [];
  for (const entry of effectsOfKind(registry, "resource", "modify-resource", "resource-limit")) {
    const effect = record(entry.effect.effect);
    if (!appliesTo(entry, context)) continue;
    const name = typeof effect.resource === "string" ? effect.resource : typeof effect.domain === "string" ? effect.domain : undefined;
    if (name === undefined || !KNOWN_RESOURCES.has(name) || (resource !== undefined && name !== resource)) continue;
    const actions = normalizedActions(effect);
    const amount = typeof effect.amount === "number" && Number.isSafeInteger(effect.amount) ? effect.amount : undefined;
    const allowed = typeof effect.allowed === "boolean" ? effect.allowed : effect.mode === "prohibit" ? false : undefined;
    result.push({
      kind: "resource", resource: name, actions, source: querySource(entry, context),
      filter: entry.effect.filter as Readonly<Record<string, unknown>>,
      ...(allowed === undefined ? {} : { allowed }), ...(amount === undefined ? {} : { amount }),
      ...(typeof effect.scope === "string" ? { scope: effect.scope as RuleUseScope } : {}),
      ...(sourcePlayerOf(entry, context) === undefined ? {} : { sourcePlayer: sourcePlayerOf(entry, context) }),
    });
  }
  return freeze(result);
}

export function actionRules(
  registry: ContinuousEffectRegistry,
  action: GameActionName,
  scope: RuleQueryScope = {},
): RuleActionQuery {
  const context = queryContext(scope, scope.object && "ref" in scope.object ? scope.object : undefined, scope.player, scope.actionKind);
  const restrictionsFound = restrictions(registry, action, scope);
  const requirementsFound = requirements(registry, action, scope);
  const costs = appliedCosts(registry, action, scope);
  const locationView = playLocations(registry, scope);
  const permissionView = permissions(registry, scope);
  const allowed = restrictionsFound.length === 0 &&
    (action !== "play" || locationView.restrictions.length === 0);
  return Object.freeze({
    action, ...(scope.actionKind === undefined ? {} : { actionKind: scope.actionKind }), allowed,
    restrictions: restrictionsFound, requirements: requirementsFound, permissions: freeze([
      ...permissionView,
      ...locationView.permissions.map(item => ({
        kind: "permission" as const, routes: [item.name], source: item.source, filter: item.filter,
        ...(item.actionKind === undefined ? {} : { actionKind: item.actionKind }),
        ...(item.sourcePlayer === undefined ? {} : { sourcePlayer: item.sourcePlayer }),
      })),
    ]), appliedCosts: costs, locations: locationView,
  });
}

function scopeFor(scope: RuleQueryScope | ObjectRef | undefined, actionKind: "play" | "activate"): RuleQueryScope {
  if (scope !== undefined && "id" in scope && "zoneEntryId" in scope) return { affected: scope, actionKind };
  return { ...(scope ?? {}), actionKind };
}

/** Action consumers fail closed when any registered restriction matches. */
export function canPlay(registry: ContinuousEffectRegistry, scope?: RuleQueryScope | ObjectRef): boolean {
  return actionRules(registry, "play", scopeFor(scope, "play")).allowed;
}
export function canActivate(registry: ContinuousEffectRegistry, scope?: RuleQueryScope | ObjectRef): boolean {
  return actionRules(registry, "activate", scopeFor(scope, "activate")).allowed;
}
export function canTarget(registry: ContinuousEffectRegistry, scope?: RuleQueryScope | ObjectRef): boolean {
  const normalized = scope !== undefined && "id" in scope && "zoneEntryId" in scope
    ? { affected: scope } : scope;
  return actionRules(registry, "target", normalized).allowed;
}
export function canPay(registry: ContinuousEffectRegistry, scope?: RuleQueryScope | ObjectRef): boolean {
  const normalized = scope !== undefined && "id" in scope && "zoneEntryId" in scope ? { affected: scope } : scope;
  return actionRules(registry, "pay", normalized).allowed;
}
export function canGainResource(registry: ContinuousEffectRegistry, resource: string, scope?: RuleQueryScope | ObjectRef): boolean {
  if (!KNOWN_RESOURCES.has(resource)) return false;
  const rules = resourceRules(registry, resource, scope);
  return rules.every(rule => rule.allowed === true);
}
export function canUseAbility(registry: ContinuousEffectRegistry, scope?: RuleQueryScope | ObjectRef, used = 0): boolean {
  if (!Number.isSafeInteger(used) || used < 0) return false;
  for (const entry of effectsOfKind(registry, "ability-count", "usage", "restriction")) {
    const effect = record(entry.effect.effect);
    const amount = effect.limit ?? effect.maxUses ?? effect.amount;
    const usageScope = effect.scope ?? effect.window ?? "turn";
    if (typeof amount === "number" && (!Number.isSafeInteger(amount) || amount < 0 ||
        typeof usageScope !== "string" || !KNOWN_USE_SCOPES.has(usageScope))) return false;
  }
  if (abilityUses(registry, scope).some(rule => rule.limit <= used)) return false;
  return canActivate(registry, scope);
}

/** Explicit check for combat consumers. Unknown flags are rejected. */
export function canApplyCombatRule(registry: ContinuousEffectRegistry, flag: string, scope?: RuleQueryScope | ObjectRef): boolean {
  if (!KNOWN_COMBAT_FLAGS.has(flag)) return false;
  return combatRules(registry, scope).some(rule => rule.flags.includes(flag));
}

/** Expiry is handled by ContinuousEffectRegistry; this helper is kept as a stable query alias. */
export function activeRuleEffects(registry: ContinuousEffectRegistry): readonly RegisteredContinuousEffect[] {
  return registeredEffects(registry);
}

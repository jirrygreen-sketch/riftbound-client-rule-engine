import type { ObjectFilter, ObjectSelector } from "@riftbound/card-dsl";
import type { LocationRef, ObjectRef, ObjectSnapshot } from "../../effects/contract.js";

type AnyRecord = Record<string, unknown>;
type SnapshotLike = ObjectSnapshot & AnyRecord;

export interface FilterMatchContext {
  /** The player used by relative player selectors such as self/opponent. */
  readonly controller?: string;
  /** The object that owns the ability/query. */
  readonly anchor?: ObjectSnapshot | null;
  /** Resolve an ObjectSelector or an extension selector to runtime snapshots. */
  readonly references?: (selector: unknown) => readonly ObjectSnapshot[];
  /** Explicit comparison object for printedCostNoMoreThanKilledUnit. */
  readonly costReference?: ObjectSnapshot | null;
  /** Visible objects used to evaluate inverse attachment predicates. */
  readonly objects?: readonly ObjectSnapshot[];
}

export function refKey(ref: ObjectRef | null | undefined): string | null {
  return ref === null || ref === undefined ? null : `${ref.id}:${ref.zoneEntryId}`;
}

export function locationKey(location: LocationRef | null | undefined): string | null {
  if (location === null || location === undefined) return null;
  return location.type === "base"
    ? JSON.stringify(["base", location.player])
    : JSON.stringify(["battlefield", location.id]);
}

/** Location equality is value equality; snapshots routinely contain fresh objects. */
export function sameLocation(left: LocationRef | null | undefined, right: LocationRef | null | undefined): boolean {
  const leftKey = locationKey(left);
  const rightKey = locationKey(right);
  return leftKey !== null && leftKey === rightKey;
}

function list(value: unknown): readonly unknown[] | null {
  return Array.isArray(value) ? value : null;
}

function record(value: unknown): AnyRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as AnyRecord : null;
}

function literal(value: unknown): unknown {
  const item = record(value);
  if (item === null) return value;
  if (item.kind === "constant" || item.kind === "literal") return literal(item.value);
  return value;
}

function printedSnapshot(object: SnapshotLike): SnapshotLike {
  const printed = object.printed;
  return record(printed) === null ? object : printed as SnapshotLike;
}

function numeric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** ObjectSnapshot.power is a domain list in the public contract, not an
 * authoritative printed Power amount. Some older adapters expose a numeric
 * Power cost, and cost receipts expose { amount } entries. Keep those forms
 * readable without treating null or a domain list as zero. */
function powerCost(value: unknown): number | null {
  const direct = numeric(value);
  if (direct !== null) return direct;
  if (!Array.isArray(value)) return null;
  if (value.length === 0) return 0;
  const amounts = value.map(item => {
    if (typeof item === "number") return item;
    const itemRecord = record(item);
    return itemRecord === null ? null : numeric(itemRecord.amount);
  });
  return amounts.every(amount => amount !== null) ? amounts.reduce((sum, amount) => sum + (amount as number), 0) : null;
}

function playerFrom(value: unknown, context: FilterMatchContext): string | null | undefined {
  const resolved = literal(value);
  if (resolved === "self" || resolved === "source" || resolved === "controller" || resolved === "you" || resolved === "caster") {
    return context.controller ?? context.anchor?.controller;
  }
  if (resolved === "opponent" || resolved === "their" || resolved === "caster-opponent") {
    return null;
  }
  const item = record(resolved);
  if (item !== null && typeof item.playerId === "string") return item.playerId;
  return typeof resolved === "string" ? resolved : undefined;
}

function playerMatches(expected: unknown, actual: string, context: FilterMatchContext): boolean {
  const resolved = literal(expected);
  if (resolved === undefined || resolved === "any") return true;
  // Preserve the layer matcher’s legacy self spelling when it is used without
  // a query anchor: the candidate is its own comparison object. Other
  // relative spellings fail closed until a controller/source is available.
  if (resolved === "self" && context.controller === undefined && context.anchor?.controller === undefined) return true;
  const relative = playerFrom(resolved, context);
  if (relative === null) {
    const controller = context.controller ?? context.anchor?.controller;
    return controller !== undefined && actual !== controller;
  }
  if (relative === undefined) return false;
  return actual === relative;
}

function keywordId(value: unknown): string | null {
  const resolved = literal(value);
  if (typeof resolved === "string") return resolved.toLowerCase();
  const item = record(resolved);
  if (item !== null && typeof item.id === "string") return item.id.toLowerCase();
  if (item !== null && typeof item.keyword === "string") return item.keyword.toLowerCase();
  return null;
}

function keywordMatches(expected: unknown, object: SnapshotLike): boolean {
  if (expected === undefined) return true;
  const values = list(expected) ?? [expected];
  return values.every(value => {
    const id = keywordId(value);
    return id !== null && object.keywords.some(keyword => keyword.id.toLowerCase() === id);
  });
}

function empoweredValue(object: SnapshotLike): number | boolean | null {
  const value = object.empowered;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean") return value;
  return null;
}

function booleanPredicate(expected: unknown, actual: boolean | null): boolean {
  if (typeof expected !== "boolean" || actual === null) return false;
  return actual === expected;
}

function isEmpowered(object: SnapshotLike): boolean | null {
  const value = empoweredValue(object);
  if (value === null) return null;
  return typeof value === "number" ? value > 0 : value;
}

function stateMatches(expected: unknown, object: SnapshotLike): boolean {
  if (expected === undefined) return true;
  const values = list(expected) ?? [expected];
  return values.every(item => {
    switch (literal(item)) {
      case "ready": return !object.exhausted;
      case "exhausted": return object.exhausted;
      case "stunned": return object.stunned;
      case "attached": return object.attachedTo !== null;
      case "face-down": return object.faceDown;
      case "damaged": return object.damage > 0;
      case "undamaged": return object.damage === 0;
      case "buffed": return object.buffs > 0;
      case "unbuffed": return object.buffs === 0;
      case "empowered": return booleanPredicate(true, isEmpowered(object));
      case "not-empowered": return booleanPredicate(false, isEmpowered(object));
      default: return false;
    }
  });
}

/** CR v1.5 818.3.b: a Top-Most card is Equipped while at least one of its
 * Attached cards is Equipment. Attachment facts live on the attached object,
 * so this predicate must inspect the visible object set rather than the
 * candidate's own `attachedTo` pointer. */
function equippedMatches(expected: unknown, object: SnapshotLike, context: FilterMatchContext): boolean {
  if (expected === undefined) return true;
  if (typeof expected !== "boolean" || context.objects === undefined) return false;
  const equipped = context.objects.some(candidate =>
    candidate.ref.id !== object.ref.id &&
    candidate.zone === "board" &&
    candidate.types.includes("gear") &&
    candidate.tags.includes("Equipment") &&
    sameRef(candidate.attachedTo, object.ref));
  return equipped === expected;
}

function typeMatches(expected: unknown, object: SnapshotLike): boolean {
  if (expected === undefined) return true;
  const values = list(expected) ?? [expected];
  return values.some(item => {
    const value = literal(item);
    return value === "object" || value === "token" && object.isToken || typeof value === "string" && object.types.includes(value);
  });
}

function zoneMatches(expected: unknown, object: SnapshotLike): boolean {
  if (expected === undefined) return true;
  const values = list(expected) ?? [expected];
  return values.some(item => {
    const value = literal(item);
    return value === object.zone || value === "discard" && object.zone === "trash" || value === "banish" && object.zone === "banishment";
  });
}

function tagsMatch(expected: unknown, object: SnapshotLike): boolean {
  if (expected === undefined) return true;
  const values = list(expected) ?? [expected];
  return values.every(item => object.tags.includes(String(literal(item))));
}

function locationMatches(expected: unknown, actual: LocationRef | null): boolean {
  if (expected === undefined) return true;
  const resolved = literal(expected);
  if (resolved === null) return actual === null;
  if (typeof resolved === "string") return actual?.type === resolved || locationKey(actual) === resolved;
  const item = record(resolved);
  if (item === null) return false;
  if (item.type === "base") {
    if (typeof item.player === "string") return locationKey(actual) === locationKey({ type: "base", player: item.player });
    return actual?.type === "base";
  }
  if (item.type === "battlefield") {
    if (typeof item.id === "string") return locationKey(actual) === locationKey({ type: "battlefield", id: item.id });
    return actual?.type === "battlefield";
  }
  return false;
}

function sameRef(left: ObjectRef | null | undefined, right: ObjectRef | null | undefined): boolean {
  return refKey(left) !== null && refKey(left) === refKey(right);
}

function snapshotsFor(selector: unknown, context: FilterMatchContext): readonly ObjectSnapshot[] {
  if (context.references !== undefined) return context.references(selector);
  const resolved = literal(selector);
  if (resolved === "self" || resolved === "source") return context.anchor === null || context.anchor === undefined ? [] : [context.anchor];
  return [];
}

function referenceMight(value: unknown, context: FilterMatchContext): number | null {
  const resolved = literal(value);
  const direct = numeric(resolved);
  if (direct !== null) return direct;
  const item = record(resolved);
  if (item !== null) {
    for (const key of ["value", "amount", "might", "max", "threshold"]) {
      const number = numeric(literal(item[key]));
      if (number !== null) return number;
    }
  }
  const refs = snapshotsFor(resolved, context);
  const target = refs[0];
  return target === undefined ? null : numeric(target.might);
}

function compareNumber(actual: unknown, expected: unknown, operator: "lt" | "lte" | "gt" | "gte" | "eq"): boolean {
  const left = numeric(actual);
  const right = numeric(expected);
  if (left === null || right === null) return false;
  if (operator === "lt") return left < right;
  if (operator === "lte") return left <= right;
  if (operator === "gt") return left > right;
  if (operator === "gte") return left >= right;
  return left === right;
}

function costNoMore(candidate: SnapshotLike, reference: SnapshotLike): boolean {
  const candidatePrinted = printedSnapshot(candidate);
  const referencePrinted = printedSnapshot(reference);
  const energy = numeric(candidatePrinted.energy);
  const referenceEnergy = numeric(referencePrinted.energy);
  const power = powerCost(candidatePrinted.power);
  const referencePower = powerCost(referencePrinted.power);
  // null means no printed cost; it is not a numeric zero and cannot satisfy an
  // ordered cost comparison without an explicit rules-backed null relation.
  return energy !== null && referenceEnergy !== null && power !== null && referencePower !== null &&
    energy <= referenceEnergy && power <= referencePower;
}

function relationMatches(value: unknown, object: SnapshotLike, context: FilterMatchContext): boolean {
  const item = record(value);
  if (item === null) return false;
  const relation = literal(item.relation);
  const selectors = [item.object, item.other].filter(selector => selector !== undefined);
  const refs = selectors.flatMap(selector => snapshotsFor(selector, context));
  if (refs.length === 0) return false;
  const target = refs[0]!;
  switch (relation) {
    case "same-location": return sameLocation(object.location, target.location);
    case "different-location": return locationKey(object.location) !== null && locationKey(target.location) !== null && locationKey(object.location) !== locationKey(target.location);
    case "same-controller": return object.controller === target.controller;
    case "different-controller": return object.controller !== target.controller;
    case "same-owner": return object.owner === target.owner;
    case "different-owner": return object.owner !== target.owner;
    case "another":
    case "other": return !sameRef(object.ref, target.ref);
    default: return false;
  }
}

// Object-filter evaluation is a per-object hot path in layers. Keep the fixed
// predicate vocabulary out of every invocation while preserving each alias's
// iteration order and short-circuiting.
const MIGHT_COMPARISONS = [
  ["mightLt", "lt"], ["mightLessThan", "lt"], ["mightLessThanTarget", "lt"],
  ["mightLte", "lte"], ["mightAtMost", "lte"], ["mightGte", "gte"], ["mightAtLeast", "gte"],
  ["mightGt", "gt"], ["mightGreaterThan", "gt"], ["mightEq", "eq"],
] as const;

const PRINTED_COST_CEILINGS = [
  ["energyMax", "energy"], ["printedEnergyMax", "energy"], ["energyAtMost", "energy"], ["costEnergyLte", "energy"],
  ["powerMax", "power"], ["printedPowerMax", "power"], ["powerAtMost", "power"],
] as const;

function numericPredicates(filter: AnyRecord, object: SnapshotLike, context: FilterMatchContext): boolean {
  const currentMight = object.might;
  for (const [key, operator] of MIGHT_COMPARISONS) {
    if (filter[key] !== undefined && !compareNumber(currentMight, referenceMight(filter[key], context), operator)) return false;
  }
  const printed = printedSnapshot(object);
  for (const [key, property] of PRINTED_COST_CEILINGS) {
    if (filter[key] === undefined) continue;
    const actual = property === "energy" ? printed.energy : powerCost(printed.power);
    if (!compareNumber(actual, filter[key], "lte")) return false;
  }
  if (filter.printedCostNoMoreThanKilledUnit !== undefined) {
    const reference = context.costReference ?? snapshotsFor(filter.killedUnit ?? filter.killed ?? filter.costReference ?? filter.other, context)[0];
    if (filter.printedCostNoMoreThanKilledUnit !== true || reference === undefined || !costNoMore(object, reference as SnapshotLike)) return false;
  }
  return true;
}

function characteristicsMatch(value: unknown, object: SnapshotLike, context: FilterMatchContext): boolean {
  const item = record(value);
  if (item === null) return true;
  return Object.entries(item).every(([key, expected]) => {
    if (key === "might") return compareNumber(object.might, expected, "eq");
    if (key === "energy") return object.energy === expected;
    if (key === "power") return JSON.stringify(object.power) === JSON.stringify(expected);
    if (key === "damaged") return booleanPredicate(expected, object.damage > 0);
    if (key === "buffed") return booleanPredicate(expected, object.buffs > 0);
    if (key === "empowered") {
      const value = empoweredValue(object);
      return booleanPredicate(expected, isEmpowered(object));
    }
    if (key === "keyword" || key === "keywords" || key === "hasKeyword") return keywordMatches(expected, object);
    if (!(key in object)) return false;
    const actual = object[key];
    return Array.isArray(expected) ? expected.includes(actual as never) : actual === expected;
  });
}

/** Shared strict matcher for both layer snapshots and interpreter query snapshots. */
export function matchesObjectPredicates(filter: ObjectFilter | Record<string, unknown>, object: ObjectSnapshot, context: FilterMatchContext = {}): boolean {
  if (!filter || typeof filter !== "object") return true;
  const value = filter as AnyRecord;
  const objectLike = object as SnapshotLike;
  const objectId = value.objectId ?? value.id;
  if (objectId !== undefined && objectId !== object.ref.id) return false;
  if (value.zoneEntryId !== undefined && value.zoneEntryId !== object.ref.zoneEntryId) return false;
  const cardId = value.cardId ?? value.canonicalCardId;
  if (cardId !== undefined && cardId !== object.cardId) return false;
  if (!typeMatches(value.type ?? value.types, objectLike)) return false;
  if (!zoneMatches(value.zone, objectLike)) return false;
  if (!locationMatches(value.location, object.location)) return false;
  if (value.locationType !== undefined && !locationMatches(value.locationType, object.location)) return false;
  if (!playerMatches(value.controller, object.controller, context)) return false;
  if (!playerMatches(value.owner, object.owner, context)) return false;
  if (!stateMatches(value.states ?? value.state, objectLike)) return false;
  if (!equippedMatches(value.equipped, objectLike, context)) return false;
  if (!tagsMatch(value.tags ?? value.tag, objectLike)) return false;
  if (!keywordMatches(value.keyword ?? value.keywords ?? value.hasKeyword, objectLike)) return false;
  if (value.damaged !== undefined && !booleanPredicate(value.damaged, object.damage > 0)) return false;
  if (value.buffed !== undefined && !booleanPredicate(value.buffed, object.buffs > 0)) return false;
  if (value.empowered !== undefined) {
    const empowered = empoweredValue(objectLike);
    if (!booleanPredicate(value.empowered, empowered === null ? null : empowered !== false && (typeof empowered === "number" ? empowered > 0 : empowered))) return false;
  }
  if (value.relation !== undefined && !relationMatches(value.relation, objectLike, context)) return false;
  if (!numericPredicates(value, objectLike, context)) return false;
  if (!characteristicsMatch(value.characteristics, objectLike, context)) return false;
  return true;
}

export function referenceMatches(left: ObjectRef | null | undefined, right: ObjectRef | null | undefined): boolean {
  return sameRef(left, right);
}

export function toObjectSelector(value: unknown): ObjectSelector | null {
  if (value === "self" || value === "source") return value;
  const item = record(value);
  if (item !== null && (typeof item.target === "string" || typeof item.pick === "string" || typeof item.linked === "string")) return value as ObjectSelector;
  return null;
}

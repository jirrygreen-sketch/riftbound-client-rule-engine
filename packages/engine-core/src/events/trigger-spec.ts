import {
  getTimingPoint,
  isTimingPointId,
  TIMING_POINT_ALIASES,
  type TimingPointId
} from "./timing-points.js";

export const TRIGGER_ONCE_SCOPES = [
  "per-turn",
  "per-phase",
  "per-combat",
  "per-showdown",
  "per-chain",
  "per-object",
  "per-batch",
  "per-game"
] as const;

export type TriggerOnceScope = (typeof TRIGGER_ONCE_SCOPES)[number];

export const OBJECT_FILTER_TYPES = [
  "object",
  "card",
  "unit",
  "spell",
  "gear",
  "rune",
  "battlefield",
  "champion",
  "legend",
  "token",
  "counter",
  "player"
] as const;

export type ObjectFilterType = (typeof OBJECT_FILTER_TYPES)[number];

export const OBJECT_FILTER_ZONES = [
  "deck",
  "hand",
  "board",
  "battlefield",
  "base",
  "rune-zone",
  "rune-deck",
  "chain",
  "trash",
  "discard",
  "banishment",
  "banish"
] as const;

export type ObjectFilterZone = (typeof OBJECT_FILTER_ZONES)[number];

export type PlayerSelector =
  | "self"
  | "opponent"
  | "any"
  | { readonly playerId: string };

export type ObjectState = "ready" | "exhausted" | "stunned" | "attached" | "face-down";

export interface ObjectFilter {
  readonly objectId?: string;
  readonly cardId?: string;
  readonly canonicalCardId?: string;
  readonly type?: ObjectFilterType | readonly ObjectFilterType[];
  readonly controller?: PlayerSelector;
  readonly owner?: PlayerSelector;
  readonly zone?: ObjectFilterZone | readonly ObjectFilterZone[];
  readonly location?: string;
  readonly states?: ObjectState | readonly ObjectState[];
  readonly tags?: readonly string[];
  readonly characteristics?: Readonly<Record<string, string | number | boolean | null>>;
}

export const EVENT_PATTERN_TYPES = [
  // Producer/event spellings retained for wire and card-program compatibility.
  "zone-entered",
  "zone-left",
  "object-entered-zone",
  "object-left-zone",
  "card-played",
  "object-targeted",
  "became-target",
  "object-killed",
  "object-readied",
  "object-exhausted",
  "attack-declared",
  "defense-declared",
  "combat-damage-before",
  "combat-damage-after",
  "showdown-opened",
  "showdown-closed",
  "combat-ended",
  "chain-item-pending",
  "chain-item-finalized",
  "chain-item-resolved",
  "control-established",
  "control-lost",
  "conquered",
  "held",
  "scored",
  "final-point",

  // Timing-point spellings.  These are aliases for the same physical event,
  // not additional emitted events.  Internal contested timings are omitted:
  // Core rule 190.3.d forbids card abilities from subscribing to them.
  "turn-start",
  "awaken-start",
  "awaken-end",
  "beginning-start",
  "beginning-end",
  "channel-start",
  "channel-end",
  "draw-start",
  "draw-end",
  "main-start",
  "main-end",
  "turn-end",
  "cleanup-start",
  "cleanup-end",
  "object-enters-zone",
  "object-leaves-zone",
  "object-enters-board",
  "object-leaves-board",
  "object-enters-battlefield",
  "object-leaves-battlefield",
  "object-enters-base",
  "object-leaves-base",
  "object-enters-deck",
  "object-leaves-deck",
  "object-enters-hand",
  "object-leaves-hand",
  "object-enters-rune-deck",
  "object-leaves-rune-deck",
  "object-enters-rune-zone",
  "object-leaves-rune-zone",
  "object-enters-trash",
  "object-leaves-trash",
  "object-enters-banishment",
  "object-leaves-banishment",
  "object-enters-chain",
  "object-leaves-chain",
  "showdown-open",
  "showdown-close",
  "combat-end",
  "chain-item-finalize",
  "chain-item-resolve",
  "conquer",
  "hold",
  "score",
  "object-moved",
  "card-drawn",
  "card-discarded",
  "damage-dealt",
  "unit-stunned",
  "xp-gained",
  "buff-added",
  "buff-spent",
  "empowered-changed",
  "card-recycled",
  "card-banished",
  "card-revealed",
  "objects-shown-off",
  "card-hidden",
  "card-burned",
  "cards-looked-at",
  "object-attached",
  "might-changed",
  "ability-activated",
  "combat-start",
  "combat-result",
  "points-gained"
] as const;

export type EventPatternType = (typeof EVENT_PATTERN_TYPES)[number];

/**
 * Return the timing identity behind either an event or timing-point spelling.
 * Validation uses this identity when `event`, `type`, and `kind` are supplied
 * together, so equivalent aliases are accepted while unrelated discriminants
 * remain a strict validation error.
 */
export function canonicalEventPatternType(value: EventPatternType): EventPatternType {
  return (Object.prototype.hasOwnProperty.call(TIMING_POINT_ALIASES, value)
    ? TIMING_POINT_ALIASES[value as keyof typeof TIMING_POINT_ALIASES]
    : value) as EventPatternType;
}

export type EventPatternScalar = string | number | boolean | null;
export type EventPatternValue = EventPatternScalar | readonly EventPatternScalar[];

export type NumericMatcher =
  | number
  | {
      readonly operator: "eq" | "neq" | "gt" | "gte" | "lt" | "lte";
      readonly value: number;
    };

export interface EventPattern {
  readonly event?: EventPatternType;
  readonly type?: EventPatternType;
  readonly kind?: EventPatternType;
  readonly object?: ObjectFilter;
  readonly source?: ObjectFilter;
  readonly target?: ObjectFilter;
  readonly player?: PlayerSelector;
  readonly fromZone?: ObjectFilterZone;
  readonly toZone?: ObjectFilterZone;
  readonly amount?: NumericMatcher;
  readonly details?: Readonly<Record<string, EventPatternValue>>;
}

export type Condition = Readonly<Record<string, unknown>> & {
  readonly kind: string;
};

export interface TriggerSpec {
  readonly at: TimingPointId;
  readonly filter: ObjectFilter | EventPattern;
  readonly condition?: Condition;
  readonly once?: TriggerOnceScope;
}

export interface ValidationIssue {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

export type ValidationResult<T> =
  | { readonly ok: true; readonly value: T; readonly issues: readonly [] }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] };

export class TriggerSpecValidationError extends TypeError {
  readonly issues: readonly ValidationIssue[];

  constructor(issues: readonly ValidationIssue[]) {
    super(issues.map(issue => `${issue.path}: ${issue.message}`).join("\n"));
    this.name = "TriggerSpecValidationError";
    this.issues = issues;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function addIssue(issues: ValidationIssue[], path: string, code: string, message: string): void {
  issues.push({ path, code, message });
}

function validateNonEmptyString(
  value: unknown,
  path: string,
  issues: ValidationIssue[]
): value is string {
  if (typeof value !== "string" || value.length === 0) {
    addIssue(issues, path, "invalid-string", "必须是非空字符串。");
    return false;
  }
  return true;
}

function validateStringArray(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  allowEmpty = true
): value is readonly string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) ||
      value.some(item => typeof item !== "string" || item.length === 0)) {
    addIssue(issues, path, "invalid-string-array", "必须是字符串数组。");
    return false;
  }
  return true;
}

function validatePlayerSelector(
  value: unknown,
  path: string,
  issues: ValidationIssue[]
): value is PlayerSelector {
  if (value === "self" || value === "opponent" || value === "any") return true;
  if (isPlainObject(value) && Object.keys(value).length === 1 &&
      validateNonEmptyString(value.playerId, `${path}.playerId`, issues)) return true;
  addIssue(issues, path, "invalid-player-selector", "必须是 self、opponent、any 或 playerId 对象。");
  return false;
}

function validateEnumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
  issues: ValidationIssue[],
  code: string
): value is T {
  if (typeof value === "string" && allowed.includes(value as T)) return true;
  addIssue(issues, path, code, `值必须属于 ${allowed.join(", ")}。`);
  return false;
}

function validateEnumOrArray<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
  issues: ValidationIssue[],
  code: string
): value is T | readonly T[] {
  if (Array.isArray(value)) {
    if (value.length > 0 && value.every(item => typeof item === "string" && allowed.includes(item as T))) {
      return true;
    }
    addIssue(issues, path, code, `数组元素必须属于 ${allowed.join(", ")}。`);
    return false;
  }
  return validateEnumValue(value, allowed, path, issues, code);
}

function validateScalar(value: unknown, path: string, issues: ValidationIssue[]): value is EventPatternScalar {
  if (value === null || typeof value === "string" || typeof value === "boolean" ||
      (typeof value === "number" && Number.isFinite(value))) return true;
  addIssue(issues, path, "invalid-scalar", "必须是字符串、有限数字、布尔值或 null。");
  return false;
}

function validateEventPatternValue(
  value: unknown,
  path: string,
  issues: ValidationIssue[]
): value is EventPatternValue {
  if (validateScalar(value, path, issues)) return true;
  if (Array.isArray(value) && value.every((item, index) => validateScalar(item, `${path}[${index}]`, issues))) {
    return true;
  }
  return false;
}

function validateObjectFilterInternal(
  value: unknown,
  path: string,
  issues: ValidationIssue[]
): value is ObjectFilter {
  if (!isPlainObject(value)) {
    addIssue(issues, path, "invalid-object", "必须是普通对象。");
    return false;
  }

  const allowed = new Set([
    "objectId", "cardId", "canonicalCardId", "type", "controller", "owner", "zone",
    "location", "states", "tags", "characteristics"
  ]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) addIssue(issues, `${path}.${key}`, "unknown-field", "ObjectFilter 不允许此字段。");
  }
  for (const key of ["objectId", "cardId", "canonicalCardId", "location"] as const) {
    if (hasOwn(value, key)) validateNonEmptyString(value[key], `${path}.${key}`, issues);
  }
  if (hasOwn(value, "type")) {
    validateEnumOrArray(value.type, OBJECT_FILTER_TYPES, `${path}.type`, issues, "invalid-object-type");
  }
  for (const key of ["controller", "owner"] as const) {
    if (hasOwn(value, key)) validatePlayerSelector(value[key], `${path}.${key}`, issues);
  }
  if (hasOwn(value, "zone")) {
    validateEnumOrArray(value.zone, OBJECT_FILTER_ZONES, `${path}.zone`, issues, "invalid-zone");
  }
  if (hasOwn(value, "states")) {
    validateEnumOrArray(
      value.states,
      ["ready", "exhausted", "stunned", "attached", "face-down"] as const,
      `${path}.states`,
      issues,
      "invalid-object-state"
    );
  }
  if (hasOwn(value, "tags")) validateStringArray(value.tags, `${path}.tags`, issues);
  if (hasOwn(value, "characteristics")) {
    if (!isPlainObject(value.characteristics)) {
      addIssue(issues, `${path}.characteristics`, "invalid-characteristics", "必须是普通对象。");
    } else {
      for (const [key, item] of Object.entries(value.characteristics)) {
        validateScalar(item, `${path}.characteristics.${key}`, issues);
      }
    }
  }
  return issues.length === 0;
}

function validateNumericMatcher(value: unknown, path: string, issues: ValidationIssue[]): boolean {
  if (typeof value === "number" && Number.isFinite(value)) return true;
  if (!isPlainObject(value) || Object.keys(value).length !== 2 ||
      !validateEnumValue(value.operator, ["eq", "neq", "gt", "gte", "lt", "lte"] as const,
        `${path}.operator`, issues, "invalid-number-operator") ||
      typeof value.value !== "number" || !Number.isFinite(value.value)) {
    addIssue(issues, path, "invalid-number-matcher", "必须是有限数字或比较对象。");
    return false;
  }
  return true;
}

function validateConditionInternal(value: unknown, path: string, issues: ValidationIssue[], seen: Set<object>): boolean {
  if (!isPlainObject(value)) {
    addIssue(issues, path, "invalid-condition", "condition 必须是普通对象。");
    return false;
  }
  if (seen.has(value)) {
    addIssue(issues, path, "cyclic-condition", "condition 不能包含循环引用。");
    return false;
  }
  seen.add(value);
  const validKind = validateNonEmptyString(value.kind, `${path}.kind`, issues);
  for (const [key, child] of Object.entries(value)) {
    if (key === "kind") continue;
    if (isPlainObject(child) && hasOwn(child, "kind")) {
      validateConditionInternal(child, `${path}.${key}`, issues, seen);
    } else if (Array.isArray(child)) {
      child.forEach((item, index) => {
        if (isPlainObject(item) && hasOwn(item, "kind")) {
          validateConditionInternal(item, `${path}.${key}[${index}]`, issues, seen);
        }
      });
    }
  }
  seen.delete(value);
  return validKind && issues.length === 0;
}

function validateEventPatternInternal(
  value: unknown,
  path: string,
  issues: ValidationIssue[]
): value is EventPattern {
  if (!isPlainObject(value)) {
    addIssue(issues, path, "invalid-event-pattern", "必须是普通对象。");
    return false;
  }
  const allowed = new Set([
    "event", "type", "kind", "object", "source", "target", "player", "fromZone", "toZone",
    "amount", "details"
  ]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) addIssue(issues, `${path}.${key}`, "unknown-field", "EventPattern 不允许此字段。");
  }
  const discriminants = ["event", "type", "kind"].filter(key => hasOwn(value, key));
  if (discriminants.length === 0) {
    addIssue(issues, `${path}.event`, "missing-event", "必须提供 event、type 或 kind。");
  } else {
    for (const key of discriminants) {
      validateEnumValue(value[key], EVENT_PATTERN_TYPES, `${path}.${key}`, issues, "invalid-event-type");
    }
    const names = discriminants.map(key => canonicalEventPatternType(value[key] as EventPatternType));
    if (new Set(names).size !== 1) addIssue(issues, path, "conflicting-event-types", "event、type、kind 必须一致。");
  }
  for (const key of ["object", "source", "target"] as const) {
    if (hasOwn(value, key)) validateObjectFilterInternal(value[key], `${path}.${key}`, issues);
  }
  if (hasOwn(value, "player")) validatePlayerSelector(value.player, `${path}.player`, issues);
  for (const key of ["fromZone", "toZone"] as const) {
    if (hasOwn(value, key)) validateEnumValue(value[key], OBJECT_FILTER_ZONES, `${path}.${key}`, issues, "invalid-zone");
  }
  if (hasOwn(value, "amount")) validateNumericMatcher(value.amount, `${path}.amount`, issues);
  if (hasOwn(value, "details")) {
    if (!isPlainObject(value.details)) {
      addIssue(issues, `${path}.details`, "invalid-details", "必须是普通对象。");
    } else {
      for (const [key, item] of Object.entries(value.details)) {
        validateEventPatternValue(item, `${path}.details.${key}`, issues);
      }
    }
  }
  return issues.length === 0;
}

function looksLikeEventPattern(value: Record<string, unknown>): boolean {
  return ["event", "kind"].some(key => hasOwn(value, key)) ||
    (hasOwn(value, "type") && typeof value.type === "string" &&
      EVENT_PATTERN_TYPES.includes(value.type as EventPatternType));
}

export function validateObjectFilter(value: unknown): ValidationResult<ObjectFilter> {
  const issues: ValidationIssue[] = [];
  validateObjectFilterInternal(value, "filter", issues);
  return issues.length === 0
    ? { ok: true, value: value as ObjectFilter, issues: [] }
    : { ok: false, issues };
}

export function validateEventPattern(value: unknown): ValidationResult<EventPattern> {
  const issues: ValidationIssue[] = [];
  validateEventPatternInternal(value, "event", issues);
  return issues.length === 0
    ? { ok: true, value: value as EventPattern, issues: [] }
    : { ok: false, issues };
}

export function validateCondition(value: unknown): ValidationResult<Condition> {
  const issues: ValidationIssue[] = [];
  validateConditionInternal(value, "condition", issues, new Set());
  return issues.length === 0
    ? { ok: true, value: value as Condition, issues: [] }
    : { ok: false, issues };
}

export function validateTriggerSpec(value: unknown): ValidationResult<TriggerSpec> {
  const issues: ValidationIssue[] = [];
  if (!isPlainObject(value)) {
    addIssue(issues, "trigger", "invalid-object", "TriggerSpec 必须是普通对象。");
    return { ok: false, issues };
  }
  const allowed = new Set(["at", "filter", "condition", "once"]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) addIssue(issues, `trigger.${key}`, "unknown-field", "TriggerSpec 不允许此字段。");
  }
  if (!hasOwn(value, "at")) {
    addIssue(issues, "trigger.at", "missing-field", "必须提供 at。");
  } else if (!isTimingPointId(value.at)) {
    addIssue(issues, "trigger.at", "invalid-timing-point", "at 必须是 TIMING_POINTS 中的封闭时点 ID。");
  } else if (getTimingPoint(value.at).triggerable === false) {
    addIssue(issues, "trigger.at", "invalid-timing-point", "该时点仅供规则内部流程，不能被卡牌触发引用。");
  }
  if (!hasOwn(value, "filter")) {
    addIssue(issues, "trigger.filter", "missing-field", "必须提供 filter。");
  } else if (!isPlainObject(value.filter)) {
    addIssue(issues, "trigger.filter", "invalid-filter", "filter 必须是 ObjectFilter 或 EventPattern。");
  } else if (looksLikeEventPattern(value.filter)) {
    validateEventPatternInternal(value.filter, "trigger.filter", issues);
  } else {
    validateObjectFilterInternal(value.filter, "trigger.filter", issues);
  }
  if (hasOwn(value, "condition")) validateConditionInternal(value.condition, "trigger.condition", issues, new Set());
  if (hasOwn(value, "once")) {
    validateEnumValue(value.once, TRIGGER_ONCE_SCOPES, "trigger.once", issues, "invalid-once-scope");
  }
  return issues.length === 0
    ? { ok: true, value: value as unknown as TriggerSpec, issues: [] }
    : { ok: false, issues };
}

export function isObjectFilter(value: unknown): value is ObjectFilter {
  return validateObjectFilter(value).ok;
}

export function isEventPattern(value: unknown): value is EventPattern {
  return validateEventPattern(value).ok;
}

export function isTriggerSpec(value: unknown): value is TriggerSpec {
  return validateTriggerSpec(value).ok;
}

export function assertObjectFilter(value: unknown): asserts value is ObjectFilter {
  const result = validateObjectFilter(value);
  if (!result.ok) throw new TriggerSpecValidationError(result.issues);
}

export function assertEventPattern(value: unknown): asserts value is EventPattern {
  const result = validateEventPattern(value);
  if (!result.ok) throw new TriggerSpecValidationError(result.issues);
}

export function assertTriggerSpec(value: unknown): asserts value is TriggerSpec {
  const result = validateTriggerSpec(value);
  if (!result.ok) throw new TriggerSpecValidationError(result.issues);
}

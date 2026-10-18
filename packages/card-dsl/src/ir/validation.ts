import {
  EFFECT_IR_V2_RULESET,
  OBJECT_FILTER_ANCHORS,
  type Ability,
  type CardProgram,
  type Condition,
  type CostSpec,
  type Expr,
  type EventObjectRole,
  type Instruction,
  type LocationSelector,
  type LocationTargetSpec,
  type ObjectFilter,
  type PickSpec,
  type Requirement,
  type Restriction,
  type TargetSpec,
  type Value
} from "./types.js";

/** One structural error reported by the EffectIR v2 validator. */
export interface CardProgramValidationIssue {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

/** The result returned by {@link validateCardProgram}. */
export type CardProgramValidationResult =
  | { readonly ok: true; readonly value: CardProgram; readonly issues: readonly [] }
  | { readonly ok: false; readonly issues: readonly CardProgramValidationIssue[] };

/** An exception containing the same path-aware issues returned by the validator. */
export class CardProgramValidationError extends Error {
  readonly issues: readonly CardProgramValidationIssue[];

  constructor(issues: readonly CardProgramValidationIssue[]) {
    super(issues.map(issue => `${issue.path}: ${issue.message}`).join("\n"));
    this.name = "CardProgramValidationError";
    this.issues = issues;
  }
}

const SYMBOL_PATTERN = /^[a-z][a-z0-9._:-]*$/;
const CONDITION_OPERATORS = new Set(["eq", "ne", "lt", "lte", "gt", "gte", "in"]);
const CONDITION_KINDS = new Set([
  "always",
  "never",
  "compare",
  "all",
  "any",
  "not",
  "expression",
  "played-from-hand",
  "playedFromHand",
  "played-from-zone",
  "playedFromZone",
  "event-printed",
  "printed-characteristic",
  "event-printed-characteristic",
  "result",
  "relation",
  "event-it"
]);
const EVENT_OBJECT_SELECTORS = new Set(["object", "source", "target", "it"]);
const OBJECT_SELECTOR_EVENT_ROLES = new Set<EventObjectRole>(["it"]);
const OBJECT_RELATIONS = new Set([
  "same-location",
  "different-location",
  "same-controller",
  "different-controller",
  "same-owner",
  "different-owner",
  "another",
  "other"
]);
const PRINTED_CHARACTERISTICS = new Set(["energy", "power", "might"]);
const SELECTIONS = new Set(["one", "any", "all", "up-to"]);
const TRIGGER_LIFETIMES = new Set(["per-turn", "per-combat", "per-chain", "per-game"]);
const ARITHMETIC_OPERATORS = new Set(["add", "sub", "subtract", "mul", "multiply", "div", "divide", "min", "max", "neg"]);

interface ValidationContext {
  readonly issues: CardProgramValidationIssue[];
  readonly instructionIds: Set<string>;
  readonly scopeInstructionIds: Set<string>;
  readonly instructionReferences: { readonly id: string; readonly path: string }[];
  readonly activeObjects: WeakSet<object>;
  readonly priorInstructionIds: Set<string>;
  readonly targetIds: Set<string>;
  readonly pickIds: Set<string>;
  readonly locationIds: Set<string>;
}

function addIssue(
  context: ValidationContext,
  path: string,
  code: string,
  message: string
): void {
  context.issues.push({ path, code, message });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function validateString(
  value: unknown,
  path: string,
  context: ValidationContext,
  message: string,
  pattern?: RegExp
): value is string {
  if (typeof value !== "string" || value.length === 0 || (pattern && !pattern.test(value))) {
    addIssue(context, path, "invalid-string", message);
    return false;
  }
  return true;
}

function validateFiniteNumber(
  value: unknown,
  path: string,
  context: ValidationContext,
  nonnegative = false
): value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || (nonnegative && value < 0)) {
    addIssue(
      context,
      path,
      "invalid-number",
      nonnegative ? "Expected a finite nonnegative number." : "Expected a finite number."
    );
    return false;
  }
  return true;
}

function validateValue(
  value: unknown,
  path: string,
  context: ValidationContext,
  active = context.activeObjects
): value is Value {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return true;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      addIssue(context, path, "invalid-value", "Values must contain finite numbers.");
      return false;
    }
    return true;
  }
  if (typeof value !== "object") {
    addIssue(context, path, "invalid-value", "Expected a JSON-compatible value.");
    return false;
  }
  if (active.has(value)) {
    addIssue(context, path, "cyclic-value", "Cyclic values are not valid EffectIR data.");
    return false;
  }
  active.add(value);
  let valid = true;
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      valid = validateValue(item, `${path}[${index}]`, context, active) && valid;
    });
  } else if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      valid = validateValue(item, `${path}.${key}`, context, active) && valid;
    }
  } else {
    addIssue(context, path, "invalid-value", "Expected a plain JSON-compatible value.");
    valid = false;
  }
  active.delete(value);
  return valid;
}

function validateExpr(value: unknown, path: string, context: ValidationContext): value is Expr {
  if (!isRecord(value)) {
    addIssue(context, path, "invalid-expression", "Expected an expression object.");
    return false;
  }
  if (context.activeObjects.has(value)) {
    addIssue(context, path, "cyclic-expression", "Cyclic expressions are not valid.");
    return false;
  }
  context.activeObjects.add(value);
  const kind = value.kind;
  let valid = true;
  if (kind === "constant" || kind === "literal") {
    if (!hasOwn(value, "value")) {
      addIssue(context, `${path}.value`, "missing-literal-value", "Expected a literal value.");
      valid = false;
    } else {
      valid = validateValue(value.value, `${path}.value`, context) && valid;
    }
  } else if (kind === "location") {
    valid = validateLocationSelector(value.value, `${path}.value`, context) && valid;
  } else if (kind === "object-property") {
    valid = validateObjectSelector(value.object, `${path}.object`, context) && valid;
    valid = validateString(value.property, `${path}.property`, context, "Expected a property name.") && valid;
  } else if (kind === "object-attribute") {
    valid = validateObjectSelector(value.object, `${path}.object`, context) && valid;
    valid = validateString(value.attribute, `${path}.attribute`, context, "Expected an attribute name.") && valid;
  } else if (kind === "object-designation") {
    valid = validateObjectSelector(value.object, `${path}.object`, context) && valid;
  } else if (kind === "player-property" || kind === "player-turn-count") {
    if (hasOwn(value, "player")) {
      valid = validatePlayerSelector(value.player, `${path}.player`, context) && valid;
    }
    if (kind === "player-property" && (typeof value.property !== "string" || !PLAYER_PROPERTIES.has(value.property))) {
      addIssue(context, `${path}.property`, "invalid-player-property", "Expected a supported numeric player property.");
      valid = false;
    }
  } else if (kind === "turn-number") {
    if (hasOwn(value, "player")) {
      addIssue(context, `${path}.player`, "invalid-turn-number-player", "Global turn-number has no player; use player-turn-count.");
      valid = false;
    }
  } else if (kind === "linked" || kind === "linked-value") {
    valid = validateString(value.instructionId, `${path}.instructionId`, context, "Expected a linked instruction id.") && valid;
    if (hasOwn(value, "key")) {
      valid = validateString(value.key, `${path}.key`, context, "Expected a linked value key.") && valid;
    }
    if (typeof value.instructionId === "string") {
      const instructionId = value.instructionId as string;
      context.instructionReferences.push({ id: instructionId, path: `${path}.instructionId` });
      if (!context.priorInstructionIds.has(instructionId)) {
        addIssue(context, `${path}.instructionId`, "linked-instruction-not-prior", "A linked value must reference a preceding instruction.");
        valid = false;
      }
    }
  } else if (kind === "count") {
    valid = validateString(value.subject, `${path}.subject`, context, "Expected a count subject.") && valid;
    if (hasOwn(value, "filter")) {
      valid = validateFilter(value.filter, `${path}.filter`, context) && valid;
    }
  } else if (kind === "arithmetic") {
    if (typeof value.operator !== "string" || !ARITHMETIC_OPERATORS.has(value.operator)) {
      addIssue(context, `${path}.operator`, "invalid-arithmetic-operator", "Expected a supported arithmetic operator.");
      valid = false;
    }
    const arity = value.operator === "neg" ? 1 : ["sub", "subtract", "div", "divide"].includes(String(value.operator)) ? 2 : undefined;
    if (!Array.isArray(value.operands) || value.operands.length === 0 || (arity !== undefined && value.operands.length !== arity)) {
      addIssue(context, `${path}.operands`, "invalid-arithmetic-operands", arity === undefined ? "Expected at least one operand expression." : `Expected ${arity} operand expressions.`);
      valid = false;
    }
    if (Array.isArray(value.operands)) {
      value.operands.forEach((operand, index) => {
        valid = validateExpr(operand, `${path}.operands[${index}]`, context) && valid;
      });
    }
  } else {
    addIssue(context, `${path}.kind`, "invalid-expression-kind", "Expected a supported value expression.");
    valid = false;
  }
  context.activeObjects.delete(value);
  return valid;
}

const PLAYER_PROPERTIES = new Set([
  "points", "score", "energy", "xp", "handSize", "handCount", "deckSize", "deckCount",
  "runeDeckSize", "runeDeckCount", "trashSize", "trashCount"
]);

function validatePlayerSelector(value: unknown, path: string, context: ValidationContext): boolean {
  if (value === "controller") return true;
  if (!isRecord(value) || Object.keys(value).length !== 1) {
    addIssue(context, path, "invalid-player-selector", "Expected controller or exactly one id, controllerOf, ownerOf, or pick selector.");
    return false;
  }
  if (hasOwn(value, "id")) return validateString(value.id, `${path}.id`, context, "Expected a player id.");
  if (hasOwn(value, "controllerOf")) return validateObjectSelector(value.controllerOf, `${path}.controllerOf`, context);
  if (hasOwn(value, "ownerOf")) return validateObjectSelector(value.ownerOf, `${path}.ownerOf`, context);
  if (hasOwn(value, "pick")) {
    if (!validateString(value.pick, `${path}.pick`, context, "Expected a player pick id.", SYMBOL_PATTERN)) return false;
    if (context.pickIds.has(value.pick)) return true;
    addIssue(context, `${path}.pick`, "unresolved-pick", `No pick specification named "${value.pick}" exists in this ability.`);
    return false;
  }
  addIssue(context, path, "invalid-player-selector", "Expected controller or exactly one id, controllerOf, ownerOf, or pick selector.");
  return false;
}

function validateObjectSelector(value: unknown, path: string, context: ValidationContext): boolean {
  if (value === "self" || value === "source") return true;
  if (!isRecord(value) || Object.keys(value).length !== 1 ||
    !["target", "pick", "linked", "event"].includes(Object.keys(value)[0]!)) {
    addIssue(context, path, "invalid-object-selector", "Expected self, source, or exactly one target, pick, linked, or event selector; runtime ObjectRefs are not IR selectors.");
    return false;
  }
  const key = Object.keys(value)[0]!;
  const id = value[key];
  if (key === "event") {
    if (typeof id !== "string" || !OBJECT_SELECTOR_EVENT_ROLES.has(id as EventObjectRole)) {
      addIssue(context, `${path}.event`, "invalid-event-object-role", "Expected the event role it.");
      return false;
    }
    return true;
  }
  if (!validateString(id, `${path}.${key}`, context, "Expected a selector id.", SYMBOL_PATTERN)) return false;
  if (key === "linked") {
    context.instructionReferences.push({ id, path: `${path}.linked` });
    if (!context.priorInstructionIds.has(id)) {
      addIssue(context, `${path}.linked`, "linked-instruction-not-prior", "An object selector must reference a preceding instruction in its link scope.");
      return false;
    }
  } else if (!(key === "target" ? context.targetIds : context.pickIds).has(id)) {
    addIssue(context, `${path}.${key}`, `unresolved-${key}`, `No ${key} specification named "${id}" exists in this ability.`);
    return false;
  }
  return true;
}

const LOCATION_RELATIONS = new Set([
  "ability-controller-base",
  "controller-base",
  "opponent-base",
  "source-location",
  "target-location",
  "target-controller-base",
  "target-owner-base"
]);

function validateLocationFilter(value: unknown, path: string, context: ValidationContext): boolean {
  if (!isRecord(value)) {
    addIssue(context, path, "invalid-location-filter", "Expected a location filter.");
    return false;
  }
  let valid = true;
  for (const [key, item] of Object.entries(value)) {
    if (["type", "kind"].includes(key)) {
      if (item !== "base" && item !== "battlefield" && item !== "any") {
        addIssue(context, `${path}.${key}`, "invalid-location-kind", "Expected base, battlefield, or any.");
        valid = false;
      }
    } else if (["occupied", "open", "controlled", "contested", "hasUnits"].includes(key)) {
      if (typeof item !== "boolean") {
        addIssue(context, `${path}.${key}`, "invalid-location-predicate", "Expected a boolean location predicate.");
        valid = false;
      }
    } else if (["player", "owner", "controller"].includes(key)) {
      if (item !== null && typeof item !== "string") {
        addIssue(context, `${path}.${key}`, "invalid-location-player", "Expected a player id, relative player, or null.");
        valid = false;
      }
    } else {
      valid = validateValue(item, `${path}.${key}`, context) && valid;
    }
  }
  return valid;
}

function validateLocationSelector(value: unknown, path: string, context: ValidationContext): value is LocationSelector {
  if (typeof value === "string") {
    if (!LOCATION_RELATIONS.has(value)) {
      addIssue(context, path, "invalid-location-selector", "Expected a supported relative location selector.");
      return false;
    }
    return true;
  }
  if (!isRecord(value)) {
    addIssue(context, path, "invalid-location-selector", "Expected a LocationRef or relative location selector.");
    return false;
  }
  if (value.type === "base") {
    return validateString(value.player, `${path}.player`, context, "Expected a base player id.");
  }
  if (value.type === "battlefield") {
    return validateString(value.id, `${path}.id`, context, "Expected a battlefield id.");
  }
  const kind = value.kind;
  if (kind === "relative") {
    let valid = typeof value.relation === "string" && LOCATION_RELATIONS.has(value.relation);
    if (!valid) addIssue(context, `${path}.relation`, "invalid-location-relation", "Expected a supported relative location relation.");
    const needsTarget = value.relation === "target-location" || value.relation === "target-controller-base" || value.relation === "target-owner-base";
    if (needsTarget && value.target === undefined) {
      addIssue(context, `${path}.target`, "missing-target", "A target-relative location requires a target id.");
      valid = false;
    }
    if (value.target !== undefined) valid = validateString(value.target, `${path}.target`, context, "Expected a target id.", SYMBOL_PATTERN) && valid;
    if (needsTarget && typeof value.target === "string" && !context.targetIds.has(value.target) && !context.locationIds.has(value.target)) {
      addIssue(context, `${path}.target`, "unresolved-target", `No target specification named "${value.target}" exists in this ability.`);
      valid = false;
    }
    return valid;
  }
  if (kind === "location-of" || kind === "location-selector") {
    const object = kind === "location-of" ? value.object : value.locationOf;
    return validateObjectSelector(object, `${path}.${kind === "location-of" ? "object" : "locationOf"}`, context);
  }
  if (kind === "target-location" || kind === "target-controller-base" || kind === "target-owner-base") {
    let valid = validateString(value.target, `${path}.target`, context, "Expected a target id.", SYMBOL_PATTERN);
    if (typeof value.target === "string" && !context.targetIds.has(value.target) && !context.locationIds.has(value.target)) {
      addIssue(context, `${path}.target`, "unresolved-target", `No target specification named "${value.target}" exists in this ability.`);
      valid = false;
    }
    return valid;
  }
  if (kind === "source-location") return true;
  if (kind === "linked-location") {
    let valid = validateString(value.instructionId, `${path}.instructionId`, context, "Expected a linked instruction id.", SYMBOL_PATTERN);
    if (valid) {
      const instructionId = value.instructionId as string;
      context.instructionReferences.push({ id: instructionId, path: `${path}.instructionId` });
      if (!context.priorInstructionIds.has(instructionId)) {
        addIssue(context, `${path}.instructionId`, "linked-instruction-not-prior", "A linked location must reference a preceding instruction.");
        valid = false;
      }
    }
    if (value.key !== undefined) valid = validateString(value.key, `${path}.key`, context, "Expected a linked location key.", SYMBOL_PATTERN) && valid;
    return valid;
  }
  if (kind === "choose") {
    let valid = validateString(value.id, `${path}.id`, context, "Expected a location choice id.", SYMBOL_PATTERN);
    if (value.options !== undefined) {
      if (!Array.isArray(value.options) || value.options.length === 0) {
        addIssue(context, `${path}.options`, "invalid-location-options", "Expected at least one location option.");
        valid = false;
      } else value.options.forEach((option, index) => { valid = validateLocationSelector(option, `${path}.options[${index}]`, context) && valid; });
    }
    if (value.filter !== undefined) valid = validateLocationFilter(value.filter, `${path}.filter`, context) && valid;
    return valid;
  }
  addIssue(context, `${path}.kind`, "invalid-location-selector", "Expected a concrete or relative location selector.");
  return false;
}

function validateLocationTarget(value: unknown, path: string, context: ValidationContext): value is LocationTargetSpec {
  if (!isRecord(value)) {
    addIssue(context, path, "invalid-location-target", "Expected a location target specification.");
    return false;
  }
  let valid = validateString(value.id, `${path}.id`, context, "Expected a location target id.", SYMBOL_PATTERN);
  valid = validateLocationFilter(value, path, context) && valid;
  valid = validateSelectionBounds(value, path, context) && valid;
  return valid;
}

function validateFilter(value: unknown, path: string, context: ValidationContext): value is ObjectFilter {
  if (!isRecord(value)) {
    addIssue(context, path, "invalid-filter", "Expected an object filter.");
    return false;
  }
  if (context.activeObjects.has(value)) {
    addIssue(context, path, "cyclic-filter", "Cyclic filters are not valid IR.");
    return false;
  }
  context.activeObjects.add(value);
  let valid = true;
  for (const [key, item] of Object.entries(value)) {
    if ((OBJECT_FILTER_ANCHORS as readonly string[]).includes(key)) {
      valid = validateObjectSelector(item, `${path}.${key}`, context) && valid;
    } else if (key === "relation") {
      if (typeof item === "string") {
        // Legacy relation labels (for example `opponent`) are opaque filter
        // data and remain accepted; structured relation objects are validated
        // below without changing their meaning.
      } else if (Array.isArray(item)) {
        if (item.length === 0) {
          addIssue(context, `${path}.relation`, "invalid-relation-filter", "Expected at least one relation filter.");
          valid = false;
        } else {
          item.forEach((relation, index) => {
            valid = validateRelationFilter(relation, `${path}.relation[${index}]`, context) && valid;
          });
        }
      } else {
        valid = validateRelationFilter(item, `${path}.relation`, context) && valid;
      }
    } else if (key === "filter") {
      valid = validateFilter(item, `${path}.filter`, context) && valid;
    } else {
      valid = validateValue(item, `${path}.${key}`, context) && valid;
    }
  }
  context.activeObjects.delete(value);
  return valid;
}

function validateRelationFilter(value: unknown, path: string, context: ValidationContext): boolean {
  if (!isRecord(value)) {
    addIssue(context, path, "invalid-relation-filter", "Expected a relation filter object.");
    return false;
  }
  let valid = typeof value.relation === "string" && OBJECT_RELATIONS.has(value.relation);
  if (!valid) addIssue(context, `${path}.relation`, "invalid-relation", "Expected a supported object relation.");
  for (const key of ["object", "other"] as const) {
    if (hasOwn(value, key)) {
      const endpoint = value[key];
      const isEventRole = typeof endpoint === "string" && EVENT_OBJECT_SELECTORS.has(endpoint);
      valid = (isEventRole || validateObjectSelector(endpoint, `${path}.${key}`, context)) && valid;
    }
  }
  return valid;
}

function validateCondition(value: unknown, path: string, context: ValidationContext): value is Condition {
  if (!isRecord(value)) {
    addIssue(context, path, "invalid-condition", "Expected a condition object.");
    return false;
  }
  const kind = value.kind;
  if (typeof kind !== "string" || !CONDITION_KINDS.has(kind)) {
    addIssue(context, `${path}.kind`, "invalid-condition-kind", "Expected a supported condition kind.");
    return false;
  }
  if (kind === "always" || kind === "never") return true;
  if (kind === "compare") {
    let valid = validateExpr(value.left, `${path}.left`, context);
    if (typeof value.operator !== "string" || !CONDITION_OPERATORS.has(value.operator)) {
      addIssue(context, `${path}.operator`, "invalid-condition-operator", "Expected a supported comparison operator.");
      valid = false;
    }
    valid = validateExpr(value.right, `${path}.right`, context) && valid;
    return valid;
  }
  if (kind === "expression") {
    return validateExpr(value.value, `${path}.value`, context);
  }
  if (kind === "played-from-hand") {
    if (value.object !== undefined && (typeof value.object !== "string" || !EVENT_OBJECT_SELECTORS.has(value.object))) {
      addIssue(context, `${path}.object`, "invalid-event-object-selector", "Expected object, source, or target.");
      return false;
    }
    return true;
  }
  if (kind === "playedFromHand") {
    if (value.object !== undefined && (typeof value.object !== "string" || !EVENT_OBJECT_SELECTORS.has(value.object))) {
      addIssue(context, `${path}.object`, "invalid-event-object-selector", "Expected object, source, or target.");
      return false;
    }
    return true;
  }
  if (kind === "played-from-zone" || kind === "playedFromZone") {
    let valid = validateString(value.zone, `${path}.zone`, context, "Expected a play-origin zone.");
    if (value.object !== undefined && (typeof value.object !== "string" || !EVENT_OBJECT_SELECTORS.has(value.object))) {
      addIssue(context, `${path}.object`, "invalid-event-object-selector", "Expected object, source, or target.");
      valid = false;
    }
    return valid;
  }
  if (kind === "event-printed" || kind === "printed-characteristic" || kind === "event-printed-characteristic") {
    let valid = true;
    if (typeof value.object !== "string" || !EVENT_OBJECT_SELECTORS.has(value.object)) {
      addIssue(context, `${path}.object`, "invalid-event-object-selector", "Expected object, source, or target.");
      valid = false;
    }
    if (typeof value.characteristic !== "string" || !PRINTED_CHARACTERISTICS.has(value.characteristic)) {
      addIssue(context, `${path}.characteristic`, "invalid-printed-characteristic", "Expected energy, power, or might.");
      valid = false;
    }
    if (typeof value.operator !== "string" || !CONDITION_OPERATORS.has(value.operator)) {
      addIssue(context, `${path}.operator`, "invalid-condition-operator", "Expected a supported comparison operator.");
      valid = false;
    }
    valid = validateExpr(value.right, `${path}.right`, context) && valid;
    return valid;
  }
  if (kind === "relation") {
    let valid = typeof value.relation === "string" && OBJECT_RELATIONS.has(value.relation);
    if (!valid) addIssue(context, `${path}.relation`, "invalid-relation", "Expected a supported object relation.");
    if (typeof value.left === "string" && EVENT_OBJECT_SELECTORS.has(value.left)) {
      // Event roles are resolved by the event predicate adapter.
    } else {
      valid = validateObjectSelector(value.left, `${path}.left`, context) && valid;
    }
    if (value.right !== undefined) {
      if (typeof value.right === "string" && EVENT_OBJECT_SELECTORS.has(value.right)) {
        // Event roles are resolved by the event predicate adapter.
      } else {
        valid = validateObjectSelector(value.right, `${path}.right`, context) && valid;
      }
    } else if (value.relation !== "another" && value.relation !== "other") {
      addIssue(context, `${path}.right`, "missing-relation-right", "This relation requires a right-hand object.");
      valid = false;
    }
    return valid;
  }
  if (kind === "event-it") {
    if (value.object !== undefined && (typeof value.object !== "string" || !EVENT_OBJECT_SELECTORS.has(value.object))) {
      addIssue(context, `${path}.object`, "invalid-event-object-selector", "Expected object, source, target, or it.");
      return false;
    }
    return true;
  }
  if (kind === "result") {
    let valid = validateString(value.result, `${path}.result`, context, "Expected a result key.", SYMBOL_PATTERN);
    if (value.id !== undefined) valid = validateString(value.id, `${path}.id`, context, "Expected a result component id.", SYMBOL_PATTERN) && valid;
    if (value.key !== undefined) valid = validateString(value.key, `${path}.key`, context, "Expected a result field key.", SYMBOL_PATTERN) && valid;
    if (value.operator !== undefined && (typeof value.operator !== "string" || !CONDITION_OPERATORS.has(value.operator))) {
      addIssue(context, `${path}.operator`, "invalid-condition-operator", "Expected a supported comparison operator.");
      valid = false;
    }
    const rhs = value.right ?? value.value;
    if (rhs !== undefined) valid = validateExpr(rhs, `${path}.${value.right !== undefined ? "right" : "value"}`, context) && valid;
    return valid;
  }
  if (kind === "not") {
    return validateCondition(value.condition, `${path}.condition`, context);
  }
  if (!Array.isArray(value.conditions) || value.conditions.length === 0) {
    addIssue(context, `${path}.conditions`, "invalid-condition-list", "Expected at least one nested condition.");
    return false;
  }
  let valid = true;
  value.conditions.forEach((condition, index) => {
    valid = validateCondition(condition, `${path}.conditions[${index}]`, context) && valid;
  });
  return valid;
}

function validateSelectionBounds(
  value: Record<string, unknown>,
  path: string,
  context: ValidationContext
): boolean {
  let valid = true;
  if (hasOwn(value, "min")) valid = validateFiniteNumber(value.min, `${path}.min`, context, true) && valid;
  if (hasOwn(value, "max") && value.max !== null) {
    valid = validateFiniteNumber(value.max, `${path}.max`, context, true) && valid;
  }
  if (hasOwn(value, "selection") && (typeof value.selection !== "string" || !SELECTIONS.has(value.selection))) {
    addIssue(context, `${path}.selection`, "invalid-selection", "Expected one, any, all, or up-to.");
    valid = false;
  }
  if (typeof value.min === "number" && typeof value.max === "number" && value.min > value.max) {
    addIssue(context, path, "invalid-selection-bounds", "The minimum selection cannot exceed the maximum.");
    valid = false;
  }
  return valid;
}

function validateTarget(value: unknown, path: string, context: ValidationContext): value is TargetSpec {
  if (!isRecord(value)) {
    addIssue(context, path, "invalid-target", "Expected a target specification.");
    return false;
  }
  let valid = validateString(value.id, `${path}.id`, context, "Expected a target id.", SYMBOL_PATTERN);
  valid = validateFilter(value.filter, `${path}.filter`, context) && valid;
  if (hasOwn(value, "location")) {
    const locationPath = `${path}.location`;
    if (isRecord(value.location) && typeof value.location.id === "string" && value.location.type === "battlefield") {
      valid = validateLocationSelector(value.location, locationPath, context) && valid;
    } else if (isRecord(value.location) && value.location.type === "base" &&
      typeof value.location.player === "string" && !["controller", "opponent"].includes(value.location.player)) {
      valid = validateLocationSelector(value.location, locationPath, context) && valid;
    } else {
      valid = validateLocationFilter(value.location, locationPath, context) && valid;
    }
  }
  valid = validateSelectionBounds(value, path, context) && valid;
  return valid;
}

function validatePick(value: unknown, path: string, context: ValidationContext): value is PickSpec {
  if (!isRecord(value)) {
    addIssue(context, path, "invalid-pick", "Expected a pick specification.");
    return false;
  }
  let valid = validateString(value.id, `${path}.id`, context, "Expected a pick id.", SYMBOL_PATTERN);
  const orderedSource = hasOwn(value, "zoneSlice") || hasOwn(value, "linked");
  if (!Array.isArray(value.options) || (!orderedSource && value.options.length === 0)) {
    addIssue(context, `${path}.options`, "invalid-pick-options", "Expected at least one non-target pick option.");
    valid = false;
  } else {
    value.options.forEach((option, index) => {
      valid = validateValue(option, `${path}.options[${index}]`, context) && valid;
    });
  }
  valid = validateSelectionBounds(value, path, context) && valid;
  if (hasOwn(value, "filter")) valid = validateFilter(value.filter, `${path}.filter`, context) && valid;
  if (hasOwn(value, "ordered") && typeof value.ordered !== "boolean") {
    addIssue(context, `${path}.ordered`, "invalid-pick-order", "Expected a boolean order flag.");
    valid = false;
  }
  if (orderedSource) {
    if (value.ordered !== true || value.selection !== "all" || !Array.isArray(value.options) || value.options.length !== 0 ||
      hasOwn(value, "filter") || hasOwn(value, "min") || hasOwn(value, "max")) {
      addIssue(context, path, "invalid-ordered-pick-source", "An ordered source requires options: [], ordered: true, selection: all, and no filter or selection bounds; perform subset choices in the resolving instruction.");
      valid = false;
    }
    if (hasOwn(value, "zoneSlice") && hasOwn(value, "linked")) {
      addIssue(context, path, "ambiguous-pick-source", "Use exactly one zone slice or linked result source.");
      valid = false;
    }
  }
  if (hasOwn(value, "zoneSlice")) valid = validatePickZoneSlice(value.zoneSlice, `${path}.zoneSlice`, context) && valid;
  if (hasOwn(value, "exclude") && !hasOwn(value, "linked")) {
    addIssue(context, `${path}.exclude`, "invalid-pick-exclusion", "An exclusion requires a linked source.");
    valid = false;
  }
  for (const key of ["linked", "exclude"]) if (hasOwn(value, key)) {
    const expression = value[key];
    if (!isRecord(expression) || !["linked", "linked-value"].includes(String(expression.kind)) || !hasOwn(expression, "key")) {
      addIssue(context, `${path}.${key}`, "invalid-pick-link", "Expected a linked expression with an explicit object-list result key.");
      valid = false;
    } else valid = validateExpr(expression, `${path}.${key}`, context) && valid;
  }
  return valid;
}

function validatePickZoneSlice(value: unknown, path: string, context: ValidationContext): boolean {
  if (!isRecord(value)) {
    addIssue(context, path, "invalid-zone-slice", "Expected a zone slice source.");
    return false;
  }
  let valid = true;
  for (const key of Object.keys(value)) if (!["player", "zone", "from", "count"].includes(key)) {
    addIssue(context, `${path}.${key}`, "invalid-zone-slice-field", "Unknown zone slice field.");
    valid = false;
  }
  if (!["hand", "deck", "rune-deck", "trash", "banishment", "board", "rune-zone", "chain"].includes(String(value.zone))) {
    addIssue(context, `${path}.zone`, "invalid-zone-slice-zone", "Expected a zone named by ResolveContext.zoneSlice.");
    valid = false;
  }
  if (value.from !== "top" && value.from !== "bottom") {
    addIssue(context, `${path}.from`, "invalid-zone-slice-edge", "Expected top or bottom.");
    valid = false;
  }
  for (const key of ["player", "count"]) if (hasOwn(value, key)) {
    valid = validateExpr(value[key], `${path}.${key}`, context) && valid;
    if (containsLinkedPickInput(value[key])) {
      addIssue(context, `${path}.${key}`, "unavailable-finalize-value", "A Finalize zone slice cannot read a Resolve-time linked value or selection.");
      valid = false;
    }
  }
  const count = value.count;
  if (isRecord(count) && ["constant", "literal"].includes(String(count.kind)) &&
    (typeof count.value !== "number" || !Number.isSafeInteger(count.value) || count.value < 0)) {
    addIssue(context, `${path}.count.value`, "invalid-zone-slice-count", "Expected a nonnegative safe integer count.");
    valid = false;
  }
  return valid;
}

/** Only source/self and state queries are available before the body executes. */
function containsLinkedPickInput(value: unknown, seen = new WeakSet<object>()): boolean {
  if (value === null || typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  if (isRecord(value) && (["linked", "linked-value"].includes(String(value.kind)) ||
    ["target", "pick", "linked"].some(key => hasOwn(value, key)))) return true;
  return Object.values(value).some(item => containsLinkedPickInput(item, seen));
}

function validateCost(value: unknown, path: string, context: ValidationContext): value is CostSpec {
  if (!isRecord(value)) {
    addIssue(context, path, "invalid-cost", "Expected a cost specification.");
    return false;
  }
  const known = ["kind", "payments", "energy", "power", "rune", "discard", "parameters", "receiptKey", "universal"];
  let valid = true;
  if (Object.keys(value).length === 0) {
    addIssue(context, path, "empty-cost", "A cost specification must contain a payment.");
    valid = false;
  }
  for (const key of Object.keys(value)) {
    if (!known.includes(key)) continue;
  }
  if (hasOwn(value, "kind")) valid = validateString(value.kind, `${path}.kind`, context, "Expected a cost kind.", SYMBOL_PATTERN) && valid;
  for (const key of ["energy", "power", "rune"]) {
    if (hasOwn(value, key)) valid = validateExpr(value[key], `${path}.${key}`, context) && valid;
  }
  if (hasOwn(value, "discard")) valid = validatePick(value.discard, `${path}.discard`, context) && valid;
  if (hasOwn(value, "receiptKey")) valid = validateString(value.receiptKey, `${path}.receiptKey`, context, "Expected a receipt key.", SYMBOL_PATTERN) && valid;
  if (hasOwn(value, "universal") && typeof value.universal !== "boolean") {
    addIssue(context, `${path}.universal`, "invalid-universal-source", "Expected a boolean Universal Power marker.");
    valid = false;
  }
  if (hasOwn(value, "parameters")) {
    if (!isRecord(value.parameters)) {
      addIssue(context, `${path}.parameters`, "invalid-cost-parameters", "Expected a parameter expression map.");
      valid = false;
    } else {
      for (const [key, expression] of Object.entries(value.parameters)) {
        valid = validateExpr(expression, `${path}.parameters.${key}`, context) && valid;
      }
    }
  }
  if (hasOwn(value, "payments")) {
    if (!Array.isArray(value.payments) || value.payments.length === 0) {
      addIssue(context, `${path}.payments`, "invalid-payments", "Expected at least one cost payment.");
      valid = false;
    } else {
      value.payments.forEach((payment, index) => {
        const paymentPath = `${path}.payments[${index}]`;
        if (!isRecord(payment)) {
          addIssue(context, paymentPath, "invalid-payment", "Expected a cost payment object.");
          valid = false;
          return;
        }
        valid = validateString(payment.kind, `${paymentPath}.kind`, context, "Expected a cost payment kind.", SYMBOL_PATTERN) && valid;
        if (hasOwn(payment, "id")) valid = validateString(payment.id, `${paymentPath}.id`, context, "Expected a payment id.", SYMBOL_PATTERN) && valid;
        if (hasOwn(payment, "amount")) valid = validateExpr(payment.amount, `${paymentPath}.amount`, context) && valid;
        if (hasOwn(payment, "value")) valid = validateExpr(payment.value, `${paymentPath}.value`, context) && valid;
        if (hasOwn(payment, "choice")) valid = validatePick(payment.choice, `${paymentPath}.choice`, context) && valid;
        if (hasOwn(payment, "source") && (typeof payment.source !== "string" || payment.source.length === 0)) {
          addIssue(context, `${paymentPath}.source`, "invalid-payment-source", "Expected a payment source name.");
          valid = false;
        }
        if (hasOwn(payment, "allowedDomains")) {
          if (!Array.isArray(payment.allowedDomains) || payment.allowedDomains.some(domain => typeof domain !== "string" || domain.length === 0)) {
            addIssue(context, `${paymentPath}.allowedDomains`, "invalid-payment-domains", "Expected a non-empty string domain list.");
            valid = false;
          }
        }
        if (hasOwn(payment, "universal") && typeof payment.universal !== "boolean") {
          addIssue(context, `${paymentPath}.universal`, "invalid-universal-source", "Expected a boolean Universal Power marker.");
          valid = false;
        }
        if (hasOwn(payment, "parameters")) {
          if (!isRecord(payment.parameters)) {
            addIssue(context, `${paymentPath}.parameters`, "invalid-payment-parameters", "Expected a parameter expression map.");
            valid = false;
          } else {
            for (const [key, expression] of Object.entries(payment.parameters)) {
              valid = validateExpr(expression, `${paymentPath}.parameters.${key}`, context) && valid;
            }
          }
        }
      });
    }
  }
  return valid;
}

function validateTaggedRuleObject(
  value: unknown,
  path: string,
  context: ValidationContext,
  label: string
): boolean {
  if (!isRecord(value)) {
    addIssue(context, path, `invalid-${label}`, `Expected a ${label} object.`);
    return false;
  }
  let valid = validateString(value.kind, `${path}.kind`, context, `Expected a ${label} kind.`, SYMBOL_PATTERN);
  if (hasOwn(value, "filter")) valid = validateFilter(value.filter, `${path}.filter`, context) && valid;
  for (const [key, item] of Object.entries(value)) {
    if (isRecord(item) && ["constant", "literal", "location", "object-property", "object-attribute", "linked", "linked-value", "count", "arithmetic", "player-property", "turn-number", "player-turn-count", "object-designation"].includes(String(item.kind))) {
      valid = validateExpr(item, `${path}.${key}`, context) && valid;
    }
  }
  return valid;
}

function validateRequirement(value: unknown, path: string, context: ValidationContext): value is Requirement {
  let valid = validateTaggedRuleObject(value, path, context, "requirement");
  if (!isRecord(value)) return false;
  if (Object.prototype.hasOwnProperty.call(value, "value")) valid = validateExpr(value.value, `${path}.value`, context) && valid;
  if (Object.prototype.hasOwnProperty.call(value, "condition")) valid = validateCondition(value.condition, `${path}.condition`, context) && valid;
  return valid;
}

function validateRestriction(value: unknown, path: string, context: ValidationContext): value is Restriction {
  let valid = validateTaggedRuleObject(value, path, context, "restriction");
  if (!isRecord(value)) return false;
  if (Object.prototype.hasOwnProperty.call(value, "value")) valid = validateExpr(value.value, `${path}.value`, context) && valid;
  if (Object.prototype.hasOwnProperty.call(value, "condition")) valid = validateCondition(value.condition, `${path}.condition`, context) && valid;
  return valid;
}

function validateInstruction(
  value: unknown,
  path: string,
  context: ValidationContext
): value is Instruction {
  if (!isRecord(value)) {
    addIssue(context, path, "invalid-instruction", "Expected an instruction object.");
    return false;
  }
  if (context.activeObjects.has(value)) {
    addIssue(context, path, "cyclic-instruction", "Cyclic instruction bodies are not valid.");
    return false;
  }
  context.activeObjects.add(value);
  let valid = true;
  const id = validateString(value.id, `${path}.id`, context, "Expected a unique instruction id.", SYMBOL_PATTERN);
  if (id && context.scopeInstructionIds.has(value.id as string)) {
    addIssue(context, `${path}.id`, "duplicate-instruction-id", `Instruction id "${value.id as string}" is already defined.`);
    valid = false;
  }
  if (id) {
    context.instructionIds.add(value.id as string);
    context.scopeInstructionIds.add(value.id as string);
  }
  validateString(value.op, `${path}.op`, context, "Expected a lowercase opcode id.", SYMBOL_PATTERN);
  if (!isRecord(value.args)) {
    addIssue(context, `${path}.args`, "invalid-arguments", "Expected an argument expression object.");
    valid = false;
  } else {
    for (const [key, expression] of Object.entries(value.args)) {
      if (key === "body" && ["sequence", "repeat", "choice.optional"].includes(String(value.op))) continue;
      valid = validateExpr(expression, `${path}.args.${key}`, context) && valid;
      if (isRecord(expression) && (expression.kind === "constant" || expression.kind === "literal")) {
        if (key === "filter") valid = validateFilter(expression.value, `${path}.args.filter.value`, context) && valid;
        if (key === "condition" && value.op === "condition.predicate") {
          valid = validateCondition(expression.value, `${path}.args.condition.value`, context) && valid;
        }
        if (key === "operands" && value.op === "condition.value" && Array.isArray(expression.value)) {
          expression.value.forEach((operand, index) => {
            valid = validateExpr(operand, `${path}.args.operands.value[${index}]`, context) && valid;
          });
        }
      }
    }
  }
  if (hasOwn(value, "linkedTo")) {
    if (!validateString(value.linkedTo, `${path}.linkedTo`, context, "Expected a linked instruction id.", SYMBOL_PATTERN)) {
      valid = false;
    } else {
      context.instructionReferences.push({ id: value.linkedTo as string, path: `${path}.linkedTo` });
      if (!context.priorInstructionIds.has(value.linkedTo as string)) {
        addIssue(context, `${path}.linkedTo`, "linked-instruction-not-prior", "linkedTo must reference a preceding instruction.");
        valid = false;
      }
    }
  }
  if (hasOwn(value, "targets")) {
    if (!Array.isArray(value.targets)) {
      addIssue(context, `${path}.targets`, "invalid-target-list", "Expected a target specification list.");
      valid = false;
    } else {
      const ids = new Set<string>();
      value.targets.forEach((target, index) => {
        valid = validateTarget(target, `${path}.targets[${index}]`, context) && valid;
        if (isRecord(target) && typeof target.id === "string") {
          if (ids.has(target.id)) {
            addIssue(context, `${path}.targets[${index}].id`, "duplicate-selection-id", `Selection id "${target.id}" is duplicated.`);
            valid = false;
          }
          ids.add(target.id);
        }
      });
    }
  }
  if (hasOwn(value, "picks")) {
    if (!Array.isArray(value.picks)) {
      addIssue(context, `${path}.picks`, "invalid-pick-list", "Expected a pick specification list.");
      valid = false;
    } else {
      const ids = new Set<string>();
      value.picks.forEach((pick, index) => {
        valid = validatePick(pick, `${path}.picks[${index}]`, context) && valid;
        if (isRecord(pick) && typeof pick.id === "string") {
          if (ids.has(pick.id)) {
            addIssue(context, `${path}.picks[${index}].id`, "duplicate-selection-id", `Selection id "${pick.id}" is duplicated.`);
            valid = false;
          }
          ids.add(pick.id);
        }
      });
    }
  }
  if (hasOwn(value, "locations")) {
    if (!Array.isArray(value.locations)) {
      addIssue(context, `${path}.locations`, "invalid-location-list", "Expected a location target specification list.");
      valid = false;
    } else {
      const ids = new Set<string>();
      value.locations.forEach((location, index) => {
        valid = validateLocationTarget(location, `${path}.locations[${index}]`, context) && valid;
        if (isRecord(location) && typeof location.id === "string") {
          if (ids.has(location.id)) {
            addIssue(context, `${path}.locations[${index}].id`, "duplicate-selection-id", `Selection id "${location.id}" is duplicated.`);
            valid = false;
          }
          ids.add(location.id);
          context.locationIds.add(location.id);
        }
      });
    }
  }
  if (hasOwn(value, "condition")) valid = validateCondition(value.condition, `${path}.condition`, context) && valid;
  if ((value.op === "sequence" || value.op === "repeat") && isRecord(value.args)) {
    valid = validateControlArgs(value.op, value.args, `${path}.args`, context) && valid;
  }
  if (value.op === "choice.optional" && isRecord(value.args)) {
    valid = validateControlArgs("sequence", value.args, `${path}.args`, context) && valid;
  }
  if (value.op === "choice.mode" && isRecord(value.args) && isRecord(value.args.modes) && Array.isArray(value.args.modes.value)) {
    value.args.modes.value.forEach((mode, index) => {
      if (isRecord(mode)) {
        valid = validateBody(mode.body, `${path}.args.modes.value[${index}].body`, {
          ...context, scopeInstructionIds: new Set(), priorInstructionIds: new Set(context.priorInstructionIds)
        }) && valid;
      }
    });
  }
  if (id) context.priorInstructionIds.add(value.id as string);
  context.activeObjects.delete(value);
  return valid;
}

function validateControlArgs(op: "sequence" | "repeat", args: Record<string, unknown>, path: string, context: ValidationContext): boolean {
  let valid = true;
  if (op === "repeat") {
    if (!hasOwn(args, "count")) {
      addIssue(context, `${path}.count`, "missing-repeat-count", "Expected a repetition count expression.");
      valid = false;
    } else if (isRecord(args.count) && (args.count.kind === "constant" || args.count.kind === "literal") &&
      (typeof args.count.value !== "number" || !Number.isSafeInteger(args.count.value) || args.count.value < 0)) {
      addIssue(context, `${path}.count.value`, "invalid-repeat-count", "Expected a nonnegative safe integer repetition count.");
      valid = false;
    }
    if (isRecord(args.reselectTargets) && (args.reselectTargets.kind === "constant" || args.reselectTargets.kind === "literal") && typeof args.reselectTargets.value !== "boolean") {
      addIssue(context, `${path}.reselectTargets.value`, "invalid-repeat-reselection", "Expected a boolean target reselection flag.");
      valid = false;
    }
  }
  if (!isRecord(args.body) || (args.body.kind !== "constant" && args.body.kind !== "literal")) {
    addIssue(context, `${path}.body`, "invalid-control-body", "Expected a constant or literal instruction body.");
    return false;
  }
  const bodyContext = op === "repeat" ? {
    ...context, scopeInstructionIds: new Set<string>(), priorInstructionIds: new Set(context.priorInstructionIds)
  } : context;
  return validateBody(args.body.value, `${path}.body.value`, bodyContext) && valid;
}

function validateBody(value: unknown, path: string, context: ValidationContext): boolean {
  if (!Array.isArray(value)) {
    addIssue(context, path, "invalid-body", "Expected an instruction list.");
    return false;
  }
  let valid = true;
  value.forEach((instruction, index) => {
    valid = validateInstruction(instruction, `${path}[${index}]`, context) && valid;
  });
  return valid;
}

function validateEventPattern(value: unknown, path: string, context: ValidationContext): boolean {
  if (!isRecord(value)) {
    addIssue(context, path, "invalid-event-pattern", "Expected an event pattern.");
    return false;
  }
  const eventName = value.event ?? value.type;
  let valid = validateString(eventName, `${path}.${value.event !== undefined ? "event" : "type"}`, context, "Expected an event name.", SYMBOL_PATTERN);
  if (hasOwn(value, "filter")) valid = validateFilter(value.filter, `${path}.filter`, context) && valid;
  if (hasOwn(value, "relations")) {
    if (!Array.isArray(value.relations) || value.relations.length === 0) {
      addIssue(context, `${path}.relations`, "invalid-event-relations", "Expected at least one relation filter.");
      valid = false;
    } else {
      value.relations.forEach((relation, index) => {
        valid = validateRelationFilter(relation, `${path}.relations[${index}]`, context) && valid;
      });
    }
  }
  if (hasOwn(value, "it")) valid = validateFilter(value.it, `${path}.it`, context) && valid;
  return valid;
}

function validateTrigger(value: unknown, path: string, context: ValidationContext): boolean {
  if (!isRecord(value)) {
    addIssue(context, path, "invalid-trigger", "Expected a trigger specification.");
    return false;
  }
  let valid = validateString(value.at, `${path}.at`, context, "Expected a timing point id.");
  if (!isRecord(value.filter)) {
    addIssue(context, `${path}.filter`, "invalid-trigger-filter", "Expected an object or event filter.");
    valid = false;
  } else if (hasOwn(value.filter, "event")) {
    valid = validateEventPattern(value.filter, `${path}.filter`, context) && valid;
  } else {
    valid = validateFilter(value.filter, `${path}.filter`, context) && valid;
  }
  if (hasOwn(value, "condition")) valid = validateCondition(value.condition, `${path}.condition`, context) && valid;
  if (hasOwn(value, "once") && (typeof value.once !== "string" || !TRIGGER_LIFETIMES.has(value.once))) {
    addIssue(context, `${path}.once`, "invalid-trigger-lifetime", "Expected a supported trigger lifetime.");
    valid = false;
  }
  return valid;
}

function validateAbility(value: unknown, path: string, context: ValidationContext): value is Ability {
  if (!isRecord(value)) {
    addIssue(context, path, "invalid-ability", "Expected an ability object.");
    return false;
  }
  const kind = value.kind;
  if (typeof kind !== "string" || !["keyword", "triggered", "activated", "static", "replacement", "play"].includes(kind)) {
    addIssue(context, `${path}.kind`, "invalid-ability-kind", "Expected keyword, triggered, activated, static, replacement, or play.");
    return false;
  }
  let valid = true;
  if (kind === "keyword") {
    valid = validateString(value.keyword, `${path}.keyword`, context, "Expected a lowercase keyword id.", SYMBOL_PATTERN);
    if (hasOwn(value, "value")) valid = validateFiniteNumber(value.value, `${path}.value`, context, true) && valid;
    if (hasOwn(value, "params")) {
      if (!isRecord(value.params)) {
        addIssue(context, `${path}.params`, "invalid-keyword-params", "Expected a keyword parameter map.");
        valid = false;
      } else {
        for (const [key, parameter] of Object.entries(value.params)) {
          if (parameter === undefined) continue;
          valid = key === "cost"
            ? validateCost(parameter, `${path}.params.${key}`, context) && valid
            : validateValue(parameter, `${path}.params.${key}`, context) && valid;
        }
      }
    }
  } else if (kind === "triggered") {
    valid = validateTrigger(value.trigger, `${path}.trigger`, context) && valid;
    if (typeof value.optional !== "boolean") {
      addIssue(context, `${path}.optional`, "invalid-optional", "Expected optional to be boolean.");
      valid = false;
    }
    valid = validateBody(value.body, `${path}.body`, context) && valid;
  } else if (kind === "activated") {
    valid = validateCost(value.cost, `${path}.cost`, context) && valid;
    if (value.timing !== "action" && value.timing !== "reaction") {
      addIssue(context, `${path}.timing`, "invalid-timing", "Expected action or reaction timing.");
      valid = false;
    }
    if (hasOwn(value, "restriction")) valid = validateRestriction(value.restriction, `${path}.restriction`, context) && valid;
    valid = validateBody(value.body, `${path}.body`, context) && valid;
  } else if (kind === "static") {
    valid = validateTaggedRuleObject(value.effect, `${path}.effect`, context, "continuous effect") && valid;
    if (isRecord(value.effect) && value.effect.kind === "target.tax") {
      const effect = value.effect;
      if (hasOwn(effect, "cost")) {
        valid = validateCost(effect.cost, `${path}.effect.cost`, context) && valid;
        if (hasOwn(effect, "value")) {
          addIssue(context, `${path}.effect.cost`, "ambiguous-target-tax", "An explicit target tax cost replaces the Deflect value; declare only one.");
          valid = false;
        }
      }
      if (hasOwn(effect, "appliesTo") && (typeof effect.appliesTo !== "string" || !["spells", "spells-and-abilities"].includes(effect.appliesTo))) {
        addIssue(context, `${path}.effect.appliesTo`, "invalid-target-tax-scope", "Expected spells or spells-and-abilities.");
        valid = false;
      }
      if (hasOwn(effect, "stage") && (typeof effect.stage !== "string" || !["mandatory-additional", "increase"].includes(effect.stage))) {
        addIssue(context, `${path}.effect.stage`, "invalid-target-tax-stage", "Expected mandatory-additional or increase.");
        valid = false;
      }
    }
    if (hasOwn(value, "condition")) valid = validateCondition(value.condition, `${path}.condition`, context) && valid;
  } else if (kind === "replacement") {
    valid = validateEventPattern(value.replaces, `${path}.replaces`, context) && valid;
    if (hasOwn(value, "condition")) valid = validateCondition(value.condition, `${path}.condition`, context) && valid;
    valid = validateBody(value.with, `${path}.with`, context) && valid;
  } else {
    if (hasOwn(value, "cost")) valid = validateCost(value.cost, `${path}.cost`, context) && valid;
    if (hasOwn(value, "requirements")) {
      if (!Array.isArray(value.requirements)) {
        addIssue(context, `${path}.requirements`, "invalid-requirements", "Expected a requirement list.");
        valid = false;
      } else {
        value.requirements.forEach((requirement, index) => {
          valid = validateRequirement(requirement, `${path}.requirements[${index}]`, context) && valid;
        });
      }
    }
    if (hasOwn(value, "restriction")) valid = validateRestriction(value.restriction, `${path}.restriction`, context) && valid;
    valid = validateBody(value.body, `${path}.body`, context) && valid;
  }
  return valid;
}

function validateDeckbuildingDecision(value: unknown, path: string, context: ValidationContext): boolean {
  if (!isRecord(value)) {
    addIssue(context, path, "invalid-deckbuilding-decision", "Expected a deckbuilding decision object.");
    return false;
  }
  let valid = validateString(value.kind, `${path}.kind`, context, "Expected a deckbuilding decision kind.", SYMBOL_PATTERN);
  if (hasOwn(value, "count")) valid = validateFiniteNumber(value.count, `${path}.count`, context, true) && valid;
  if (hasOwn(value, "options")) {
    if (!Array.isArray(value.options) || value.options.length === 0) {
      addIssue(context, `${path}.options`, "invalid-deckbuilding-options", "Expected at least one option.");
      valid = false;
    } else {
      value.options.forEach((option, index) => {
        valid = validateValue(option, `${path}.options[${index}]`, context) && valid;
      });
    }
  }
  return valid;
}

/** Collect declarations before checking uses; selectors are ability-local. */
function collectSelections(value: unknown, context: ValidationContext, seen = new WeakSet<object>()): void {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach(item => collectSelections(item, context, seen));
  } else if (isRecord(value)) {
    for (const key of typeof value.op === "string" ? ["targets", "picks", "locations"] : []) {
      const selections = value[key];
      if (Array.isArray(selections)) {
        for (const spec of selections) {
          if (isRecord(spec) && typeof spec.id === "string") {
            if (key === "targets") context.targetIds.add(spec.id);
            else if (key === "picks") context.pickIds.add(spec.id);
            else context.locationIds.add(spec.id);
          }
        }
      }
    }
    for (const key of ["discard", "choice"]) {
      const spec = value[key];
      if (isRecord(spec) && typeof spec.id === "string" && Array.isArray(spec.options)) context.pickIds.add(spec.id);
    }
    // Ordinary constants are data, not declarations; control bodies are IR.
    if (value.kind === "constant" || value.kind === "literal") return;
    for (const [key, item] of Object.entries(value)) {
      if (key === "args" && isRecord(item)) {
        for (const [arg, expression] of Object.entries(item)) {
          if (arg === "body" && ["sequence", "repeat", "choice.optional"].includes(String(value.op)) && isRecord(expression)) {
            collectSelections(expression.value, context, seen);
          } else if (arg === "modes" && value.op === "choice.mode" && isRecord(expression)) {
            collectSelections(expression.value, context, seen);
          }
        }
      } else if (["body", "with", "cost", "payments", "choice", "discard"].includes(key)) collectSelections(item, context, seen);
    }
  }
}

/** Runtime identities are forbidden even in extension metadata or literal data. */
function rejectRuntimeRefs(value: unknown, path: string, context: ValidationContext, seen = new WeakSet<object>()): void {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) value.forEach((item, index) => rejectRuntimeRefs(item, `${path}[${index}]`, context, seen));
  else if (isRecord(value)) {
    if (hasOwn(value, "id") && hasOwn(value, "zoneEntryId")) {
      addIssue(context, path, "invalid-object-selector", "Runtime ObjectRefs cannot appear in static IR; use an ObjectSelector.");
    }
    for (const [key, item] of Object.entries(value)) rejectRuntimeRefs(item, `${path}.${key}`, context, seen);
  }
}

/** Validate one EffectIR v2 card program and return every path-aware issue. */
export function validateCardProgram(input: unknown): CardProgramValidationResult {
  if (!isRecord(input)) {
    return {
      ok: false,
      issues: [{ path: "$", code: "invalid-program", message: "Expected a CardProgram object." }]
    };
  }

  const context: ValidationContext = {
    issues: [],
    instructionIds: new Set<string>(),
    scopeInstructionIds: new Set<string>(),
    instructionReferences: [],
    activeObjects: new WeakSet<object>(),
    priorInstructionIds: new Set<string>(),
    targetIds: new Set<string>(),
    pickIds: new Set<string>(),
    locationIds: new Set<string>()
  };
  rejectRuntimeRefs(input, "$", context);

  const allowed = new Set(["canonicalCardId", "rulesetVersion", "status", "judgeReason", "abilities", "deckbuilding", "sourceText"]);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) addIssue(context, `$.${key}`, "unknown-field", "Unknown CardProgram field.");
  }
  for (const key of ["canonicalCardId", "sourceText"]) {
    if (!hasOwn(input, key)) addIssue(context, `$.${key}`, "missing-field", "Required field is missing.");
  }
  validateString(input.canonicalCardId, "$.canonicalCardId", context, "Expected a canonical card id.");
  if (input.rulesetVersion !== EFFECT_IR_V2_RULESET) {
    addIssue(context, "$.rulesetVersion", "unsupported-ruleset", `Expected ruleset version "${EFFECT_IR_V2_RULESET}".`);
  }
  if (input.status !== "executable" && input.status !== "judge-required" && input.status !== "no-ability") {
    addIssue(context, "$.status", "invalid-status", "Expected executable, judge-required, or no-ability.");
  }
  validateString(input.sourceText, "$.sourceText", context, "Expected the original card text.");

  if (input.status === "judge-required") {
    if (!validateString(input.judgeReason, "$.judgeReason", context, "judge-required programs must explain the unresolved rule.")) {
      // The issue is already recorded at the contract path.
    }
  } else if (hasOwn(input, "judgeReason") && input.judgeReason !== undefined) {
    addIssue(context, "$.judgeReason", "unexpected-judge-reason", "judgeReason is only valid for judge-required programs.");
  }

  if (!Array.isArray(input.abilities)) {
    addIssue(context, "$.abilities", "invalid-abilities", "Expected an ability list.");
  } else {
    if (input.status === "no-ability" && input.abilities.length !== 0) {
      addIssue(context, "$.abilities", "no-ability-has-abilities", "A no-ability program cannot contain abilities.");
    }
    input.abilities.forEach((ability, index) => {
      const abilityContext: ValidationContext = {
        ...context, instructionIds: new Set(), scopeInstructionIds: new Set(),
        instructionReferences: [], priorInstructionIds: new Set(), targetIds: new Set(), pickIds: new Set(),
        locationIds: new Set()
      };
      collectSelections(ability, abilityContext);
      validateAbility(ability, `$.abilities[${index}]`, abilityContext);
      for (const reference of abilityContext.instructionReferences) {
        if (!abilityContext.instructionIds.has(reference.id)) {
          addIssue(context, reference.path, "unresolved-instruction", `Instruction id "${reference.id}" does not exist in this ability.`);
        }
      }
    });
  }
  if (hasOwn(input, "deckbuilding")) {
    if (!Array.isArray(input.deckbuilding)) {
      addIssue(context, "$.deckbuilding", "invalid-deckbuilding", "Expected a deckbuilding decision list.");
    } else {
      input.deckbuilding.forEach((decision, index) => {
        validateDeckbuildingDecision(decision, `$.deckbuilding[${index}]`, context);
      });
    }
  }

  for (const reference of context.instructionReferences) {
    if (!context.instructionIds.has(reference.id)) {
      addIssue(context, reference.path, "unresolved-instruction", `Instruction id "${reference.id}" does not exist.`);
    }
  }

  if (context.issues.length > 0) return { ok: false, issues: context.issues };
  return { ok: true, value: input as unknown as CardProgram, issues: [] };
}

/** Return true when a value is a structurally valid EffectIR v2 program. */
export function isCardProgram(input: unknown): input is CardProgram {
  return validateCardProgram(input).ok;
}

/** Validate and return a CardProgram, throwing its path-aware validation error on failure. */
export function parseCardProgram(input: unknown): CardProgram {
  const result = validateCardProgram(input);
  if (!result.ok) throw new CardProgramValidationError(result.issues);
  return result.value;
}

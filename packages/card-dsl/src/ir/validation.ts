import {
  EFFECT_IR_V2_RULESET,
  OBJECT_FILTER_ANCHORS,
  type Ability,
  type CardProgram,
  type Condition,
  type CostSpec,
  type Expr,
  type Instruction,
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
  "expression"
]);
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
  } else if (kind === "object-property") {
    valid = validateObjectSelector(value.object, `${path}.object`, context) && valid;
    valid = validateString(value.property, `${path}.property`, context, "Expected a property name.") && valid;
  } else if (kind === "object-attribute") {
    valid = validateObjectSelector(value.object, `${path}.object`, context) && valid;
    valid = validateString(value.attribute, `${path}.attribute`, context, "Expected an attribute name.") && valid;
  } else if (kind === "linked" || kind === "linked-value") {
    valid = validateString(value.instructionId, `${path}.instructionId`, context, "Expected a linked instruction id.") && valid;
    if (hasOwn(value, "key")) {
      valid = validateString(value.key, `${path}.key`, context, "Expected a linked value key.") && valid;
    }
    if (typeof value.instructionId === "string") {
      context.instructionReferences.push({ id: value.instructionId, path: `${path}.instructionId` });
      if (!context.priorInstructionIds.has(value.instructionId)) {
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
    addIssue(context, `${path}.kind`, "invalid-expression-kind", "Expected constant, object property, linked value, count, or arithmetic.");
    valid = false;
  }
  context.activeObjects.delete(value);
  return valid;
}

function validateObjectSelector(value: unknown, path: string, context: ValidationContext): boolean {
  if (value === "self" || value === "source") return true;
  if (!isRecord(value) || Object.keys(value).length !== 1 ||
    !["target", "pick", "linked"].includes(Object.keys(value)[0]!)) {
    addIssue(context, path, "invalid-object-selector", "Expected self, source, or exactly one target, pick, or linked id; runtime ObjectRefs are not IR selectors.");
    return false;
  }
  const key = Object.keys(value)[0]!;
  const id = value[key];
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
    } else if (key === "filter") {
      valid = validateFilter(item, `${path}.filter`, context) && valid;
    } else {
      valid = validateValue(item, `${path}.${key}`, context) && valid;
    }
  }
  context.activeObjects.delete(value);
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
  valid = validateSelectionBounds(value, path, context) && valid;
  return valid;
}

function validatePick(value: unknown, path: string, context: ValidationContext): value is PickSpec {
  if (!isRecord(value)) {
    addIssue(context, path, "invalid-pick", "Expected a pick specification.");
    return false;
  }
  let valid = validateString(value.id, `${path}.id`, context, "Expected a pick id.", SYMBOL_PATTERN);
  if (!Array.isArray(value.options) || value.options.length === 0) {
    addIssue(context, `${path}.options`, "invalid-pick-options", "Expected at least one non-target pick option.");
    valid = false;
  } else {
    value.options.forEach((option, index) => {
      valid = validateValue(option, `${path}.options[${index}]`, context) && valid;
    });
  }
  valid = validateSelectionBounds(value, path, context) && valid;
  if (hasOwn(value, "filter")) valid = validateFilter(value.filter, `${path}.filter`, context) && valid;
  return valid;
}

function validateCost(value: unknown, path: string, context: ValidationContext): value is CostSpec {
  if (!isRecord(value)) {
    addIssue(context, path, "invalid-cost", "Expected a cost specification.");
    return false;
  }
  const known = ["kind", "payments", "energy", "power", "rune", "discard"];
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
        if (hasOwn(payment, "amount")) valid = validateExpr(payment.amount, `${paymentPath}.amount`, context) && valid;
        if (hasOwn(payment, "value")) valid = validateExpr(payment.value, `${paymentPath}.value`, context) && valid;
        if (hasOwn(payment, "choice")) valid = validatePick(payment.choice, `${paymentPath}.choice`, context) && valid;
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
    if (isRecord(item) && ["constant", "literal", "object-property", "object-attribute", "linked", "linked-value", "count", "arithmetic"].includes(String(item.kind))) {
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
    for (const key of typeof value.op === "string" ? ["targets", "picks"] : []) {
      const selections = value[key];
      if (Array.isArray(selections)) {
        for (const spec of selections) {
          if (isRecord(spec) && typeof spec.id === "string") {
            (key === "targets" ? context.targetIds : context.pickIds).add(spec.id);
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
    pickIds: new Set<string>()
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
        instructionReferences: [], priorInstructionIds: new Set(), targetIds: new Set(), pickIds: new Set()
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

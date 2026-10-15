import {
  EFFECT_IR_SCHEMA_VERSION,
  ID_PATTERN,
  SYMBOL_PATTERN,
  SYNTHETIC_DEMO_RULESET
} from "./constants.js";
import {
  EFFECT_OPCODES,
  EFFECT_OPCODE_SPECS,
  EffectIrValidationError
} from "./effect-ir-types.js";
import type {
  EffectIr,
  EffectIrNode,
  EffectIrValidationIssue,
  EffectIrValidationResult,
  EffectOpcode,
  EffectOpcodeSpec
} from "./effect-ir-types.js";
import type { JsonValue } from "./types.js";

function isEffectIrRecord(value: unknown): value is Record<string, unknown> {
  return isPlainJsonObject(value);
}

function addIrIssue(
  issues: EffectIrValidationIssue[],
  path: string,
  code: string,
  message: string
): void {
  issues.push({ path, code, message });
}

function isPlainJsonObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validateEffectArguments(
  value: unknown,
  spec: EffectOpcodeSpec,
  path: string,
  issues: EffectIrValidationIssue[]
): Record<string, JsonValue> | null {
  if (!isPlainJsonObject(value)) {
    addIrIssue(issues, path, "invalid-arguments", "Expected a JSON object.");
    return null;
  }

  const argumentKeys = new Set(Object.keys(value));
  const knownArgumentKeys = new Set(
    spec.arguments.map(argument => argument.key)
  );
  for (const key of argumentKeys) {
    if (!knownArgumentKeys.has(key)) {
      addIrIssue(
        issues,
        `${path}.${key}`,
        "unknown-argument",
        `Argument "${key}" is not defined for this opcode.`
      );
    }
  }
  for (const argument of spec.arguments) {
    if (!Object.prototype.hasOwnProperty.call(value, argument.key)) {
      if (argument.required) {
        addIrIssue(
          issues,
          `${path}.${argument.key}`,
          "missing-argument",
          `Required argument "${argument.key}" is missing.`
        );
      }
      continue;
    }

    const candidate = (value as Record<string, unknown>)[argument.key];
    if (argument.type === "integer" &&
        (typeof candidate !== "number" || !Number.isSafeInteger(candidate) || candidate < 0)) {
      addIrIssue(
        issues,
        `${path}.${argument.key}`,
        "invalid-integer",
        "Expected a safe nonnegative integer."
      );
    }
    if (argument.type === "player" &&
        (candidate !== "self" && candidate !== "opponent")) {
      addIrIssue(
        issues,
        `${path}.${argument.key}`,
        "invalid-player",
        'Expected "self" or "opponent".'
      );
    }
  }

  if (issues.some(issue => issue.path.startsWith(`${path}.`))) {
    return null;
  }
  return value as Record<string, JsonValue>;
}

function validateEffectIrNode(
  value: unknown,
  path: string,
  context: {
    issues: EffectIrValidationIssue[];
    ids: Set<string>;
    targets: Set<string>;
    targetReferences: { id: string; path: string }[];
  }
): EffectIrNode | null {
  if (!isEffectIrRecord(value)) {
    addIrIssue(context.issues, path, "invalid-node", "Expected an AST node.");
    return null;
  }

  if (value.type === "target") {
    const keys = Object.keys(value);
    if (!["type", "id", "placeholder", "minCount", "maxCount"].every(key =>
      keys.includes(key)
    ) || keys.length !== 5) {
      addIrIssue(
        context.issues,
        path,
        "unknown-field",
        "Target fields must be exactly type, id, placeholder, minCount, and maxCount."
      );
      return null;
    }
    if (typeof value.id !== "string" || !ID_PATTERN.test(value.id)) {
      addIrIssue(context.issues, `${path}.id`, "invalid-identifier", "Expected a stable node id.");
      return null;
    }
    if (context.ids.has(value.id)) {
      addIrIssue(context.issues, `${path}.id`, "duplicate-node-id", `Node id "${value.id}" is already used.`);
      return null;
    }
    if (typeof value.placeholder !== "string" || !SYMBOL_PATTERN.test(value.placeholder)) {
      addIrIssue(context.issues, `${path}.placeholder`, "invalid-placeholder", "Expected a symbolic placeholder.");
      return null;
    }
    if (typeof value.minCount !== "number" ||
        !Number.isSafeInteger(value.minCount) ||
        value.minCount < 0 ||
        value.maxCount !== null && (typeof value.maxCount !== "number" ||
          !Number.isSafeInteger(value.maxCount) ||
          value.maxCount < value.minCount)) {
      addIrIssue(context.issues, path, "invalid-count", "Expected minCount and maxCount to form a valid range.");
      return null;
    }
    context.ids.add(value.id);
    context.targets.add(value.id);
    return {
      type: "target",
      id: value.id,
      placeholder: value.placeholder,
      minCount: value.minCount,
      maxCount: value.maxCount
    };
  }

  if (value.type === "effect") {
    const keys = Object.keys(value);
    const allowed = ["type", "id", "opcode", "args", "targetId"];
    if (keys.some(key => !allowed.includes(key)) || !keys.includes("targetId") && keys.length < 4) {
      addIrIssue(context.issues, path, "unknown-field", "Effect contains unknown or missing fields.");
      return null;
    }
    if (typeof value.id !== "string" || !ID_PATTERN.test(value.id)) {
      addIrIssue(context.issues, `${path}.id`, "invalid-identifier", "Expected a stable node id.");
      return null;
    }
    if (context.ids.has(value.id)) {
      addIrIssue(context.issues, `${path}.id`, "duplicate-node-id", `Node id "${value.id}" is already used.`);
      return null;
    }
    if (typeof value.opcode !== "string" || !EFFECT_OPCODES.includes(value.opcode as EffectOpcode)) {
      addIrIssue(
        context.issues,
        `${path}.opcode`,
        "unknown-opcode",
        `Expected one of: ${EFFECT_OPCODES.join(", ")}.`
      );
      return null;
    }

    const spec = EFFECT_OPCODE_SPECS[value.opcode as EffectOpcode];
    const args = validateEffectArguments(value.args, spec, `${path}.args`, context.issues);
    if (spec.requiresTarget && typeof value.targetId !== "string") {
      addIrIssue(context.issues, `${path}.targetId`, "missing-target", "This opcode requires a target reference.");
    }
    if (!spec.requiresTarget && value.targetId !== undefined) {
      addIrIssue(context.issues, `${path}.targetId`, "unexpected-target", "This opcode does not accept a target.");
    }
    if (typeof value.targetId === "string") {
      if (!ID_PATTERN.test(value.targetId)) {
        addIrIssue(context.issues, `${path}.targetId`, "invalid-target", "Expected a target node id.");
      } else {
        context.targetReferences.push({ id: value.targetId, path: `${path}.targetId` });
      }
    }

    if (context.issues.some(issue => issue.path.startsWith(`${path}.`)) || args === null) {
      return null;
    }
    context.ids.add(value.id);
    return value.targetId === undefined
      ? { type: "effect", id: value.id, opcode: spec.operation, args }
      : { type: "effect", id: value.id, opcode: spec.operation, args, targetId: value.targetId as string };
  }

  if (value.type === "trigger") {
    const keys = Object.keys(value);
    if (!["type", "id", "event", "body"].every(key => keys.includes(key)) ||
        keys.some(key => !["type", "id", "event", "body"].includes(key))) {
      addIrIssue(context.issues, path, "unknown-field", "Trigger fields must be exactly type, id, event, and body.");
      return null;
    }
    if (typeof value.id !== "string" || !ID_PATTERN.test(value.id)) {
      addIrIssue(context.issues, `${path}.id`, "invalid-identifier", "Expected a stable node id.");
      return null;
    }
    if (context.ids.has(value.id)) {
      addIrIssue(context.issues, `${path}.id`, "duplicate-node-id", `Node id "${value.id}" is already used.`);
      return null;
    }
    if (typeof value.event !== "string" || !SYMBOL_PATTERN.test(value.event)) {
      addIrIssue(context.issues, `${path}.event`, "invalid-event", "Expected a symbolic event name.");
      return null;
    }
    if (!Array.isArray(value.body) || value.body.length === 0) {
      addIrIssue(context.issues, `${path}.body`, "invalid-body", "Expected a nonempty body.");
      return null;
    }
    context.ids.add(value.id);
    const body: EffectIrNode[] = [];
    value.body.forEach((item, index) => {
      const node = validateEffectIrNode(item, `${path}.body[${index}]`, context);
      if (node !== null) body.push(node);
    });
    if (context.issues.some(issue => issue.path.startsWith(`${path}.body[`))) {
      return null;
    }
    return { type: "trigger", id: value.id, event: value.event, body };
  }

  addIrIssue(
    context.issues,
    `${path}.type`,
    "unknown-node-type",
    "Expected target, effect, or trigger."
  );
  return null;
}

export function validateEffectIr(input: unknown): EffectIrValidationResult {
  if (!isEffectIrRecord(input)) {
    return {
      ok: false,
      issues: [{ path: "$", code: "invalid-document", message: "Expected an EffectIR object." }]
    };
  }

  const context = {
    issues: [] as EffectIrValidationIssue[],
    ids: new Set<string>(),
    targets: new Set<string>(),
    targetReferences: [] as { id: string; path: string }[]
  };
  const keys = Object.keys(input);
  const required = ["kind", "schemaVersion", "ruleset", "id", "body"];
  if (keys.some(key => !required.includes(key)) ||
      !required.every(key => Object.prototype.hasOwnProperty.call(input, key))) {
    addIrIssue(context.issues, "$", "unknown-field", "EffectIR fields must be exactly kind, schemaVersion, ruleset, id, and body.");
  }
  if (input.kind !== "effect-ir") {
    addIrIssue(context.issues, "$.kind", "invalid-kind", 'Expected "effect-ir".');
  }
  if (input.schemaVersion !== EFFECT_IR_SCHEMA_VERSION) {
    addIrIssue(context.issues, "$.schemaVersion", "unsupported-schema-version", `Expected schema version ${EFFECT_IR_SCHEMA_VERSION}.`);
  }
  if (input.ruleset !== SYNTHETIC_DEMO_RULESET) {
    addIrIssue(context.issues, "$.ruleset", "unsupported-ruleset", `Expected ruleset "${SYNTHETIC_DEMO_RULESET}".`);
  }
  if (typeof input.id !== "string" || !ID_PATTERN.test(input.id)) {
    addIrIssue(context.issues, "$.id", "invalid-identifier", "Expected a stable card id.");
  }
  if (!Array.isArray(input.body) || input.body.length === 0) {
    addIrIssue(context.issues, "$.body", "invalid-body", "Expected a nonempty body.");
  } else {
    const body: EffectIrNode[] = [];
    input.body.forEach((item, index) => {
      const node = validateEffectIrNode(item, `$.body[${index}]`, context);
      if (node !== null) body.push(node);
    });
  }

  for (const reference of context.targetReferences) {
    if (!context.targets.has(reference.id)) {
      addIrIssue(context.issues, reference.path, "unresolved-target", `Target id "${reference.id}" does not exist.`);
    }
  }

  if (context.issues.length > 0) {
    return { ok: false, issues: context.issues };
  }

  return {
    ok: true,
    issues: [],
    value: input as unknown as EffectIr
  };
}

export function parseEffectIr(input: unknown): EffectIr {
  const result = validateEffectIr(input);
  if (!result.ok) {
    throw new EffectIrValidationError(result.issues);
  }
  return result.value;
}

export function isEffectIr(input: unknown): input is EffectIr {
  return validateEffectIr(input).ok;
}

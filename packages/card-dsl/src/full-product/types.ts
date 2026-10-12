export const FULL_PRODUCT_EFFECT_IR_KIND = "full-product-effect-ir" as const;
export const FULL_PRODUCT_EFFECT_IR_SCHEMA_VERSION = 1 as const;
export const FULL_PRODUCT_EFFECT_IR_RULESET = "full-product" as const;

export type FullProductJsonPrimitive = string | number | boolean | null;
export type FullProductJsonValue =
  | FullProductJsonPrimitive
  | FullProductJsonObject
  | readonly FullProductJsonValue[];

export interface FullProductJsonObject {
  readonly [key: string]: FullProductJsonValue;
}

export type FullProductEffectOpcode =
  | "cost.energy"
  | "draw.cards"
  | "gain.energy"
  | "gain.score"
  | "move.zone"
  | "prompt.target"
  | "chain.create"
  | "judge.required";

export const FULL_PRODUCT_EFFECT_OPCODES = [
  "cost.energy",
  "draw.cards",
  "gain.energy",
  "gain.score",
  "move.zone",
  "prompt.target",
  "chain.create",
  "judge.required"
] as const satisfies readonly FullProductEffectOpcode[];

export type FullProductMoveZone = "discard";
export type FullProductEffectArgumentType =
  | "nonnegative-integer"
  | "move-zone"
  | "text";

export interface FullProductEffectArgumentSpec {
  readonly key: string;
  readonly required: true;
  readonly type: FullProductEffectArgumentType;
}

export interface FullProductEffectOpcodeSpec {
  readonly opcode: FullProductEffectOpcode;
  readonly arguments: readonly FullProductEffectArgumentSpec[];
  readonly requiresTarget: boolean;
}

export const FULL_PRODUCT_EFFECT_OPCODE_SPECS: Readonly<
  Record<FullProductEffectOpcode, FullProductEffectOpcodeSpec>
> = {
  "cost.energy": {
    opcode: "cost.energy",
    arguments: [{ key: "amount", required: true, type: "nonnegative-integer" }],
    requiresTarget: false
  },
  "draw.cards": {
    opcode: "draw.cards",
    arguments: [{ key: "count", required: true, type: "nonnegative-integer" }],
    requiresTarget: false
  },
  "gain.energy": {
    opcode: "gain.energy",
    arguments: [{ key: "amount", required: true, type: "nonnegative-integer" }],
    requiresTarget: false
  },
  "gain.score": {
    opcode: "gain.score",
    arguments: [{ key: "amount", required: true, type: "nonnegative-integer" }],
    requiresTarget: false
  },
  "move.zone": {
    opcode: "move.zone",
    arguments: [{ key: "zone", required: true, type: "move-zone" }],
    requiresTarget: false
  },
  "prompt.target": {
    opcode: "prompt.target",
    arguments: [{ key: "prompt", required: true, type: "text" }],
    requiresTarget: true
  },
  "chain.create": {
    opcode: "chain.create",
    arguments: [{ key: "count", required: true, type: "nonnegative-integer" }],
    requiresTarget: false
  },
  "judge.required": {
    opcode: "judge.required",
    arguments: [{ key: "reason", required: true, type: "text" }],
    requiresTarget: false
  }
};

export interface FullProductEffectIrTarget {
  readonly type: "target";
  readonly id: string;
  readonly placeholder: string;
  readonly minCount: number;
  readonly maxCount: number | null;
}

export interface FullProductEffectIrEffect {
  readonly type: "effect";
  readonly id: string;
  readonly opcode: FullProductEffectOpcode;
  readonly args: FullProductJsonObject;
  readonly targetId?: string;
}

export interface FullProductEffectIrTrigger {
  readonly type: "trigger";
  readonly id: string;
  readonly event: string;
  readonly body: readonly FullProductEffectIrNode[];
}

export type FullProductEffectIrNode =
  | FullProductEffectIrTarget
  | FullProductEffectIrEffect
  | FullProductEffectIrTrigger;

export interface FullProductEffectIr {
  readonly kind: typeof FULL_PRODUCT_EFFECT_IR_KIND;
  readonly schemaVersion: typeof FULL_PRODUCT_EFFECT_IR_SCHEMA_VERSION;
  readonly ruleset: typeof FULL_PRODUCT_EFFECT_IR_RULESET;
  readonly id: string;
  readonly body: readonly FullProductEffectIrNode[];
}

export interface FullProductEffectIrValidationIssue {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

export type FullProductEffectIrValidationResult =
  | {
      readonly ok: true;
      readonly value: FullProductEffectIr;
      readonly issues: readonly [];
    }
  | {
      readonly ok: false;
      readonly issues: readonly FullProductEffectIrValidationIssue[];
    };

export class FullProductEffectIrValidationError extends Error {
  readonly issues: readonly FullProductEffectIrValidationIssue[];

  constructor(issues: readonly FullProductEffectIrValidationIssue[]) {
    super(issues.map(issue => `${issue.path}: ${issue.message}`).join("\n"));
    this.name = "FullProductEffectIrValidationError";
    this.issues = issues;
  }
}

const ID_PATTERN = /^[a-z][a-z0-9._-]*$/;
const SYMBOL_PATTERN = /^[a-z][a-z0-9._:-]*$/;

interface ValidationContext {
  readonly issues: FullProductEffectIrValidationIssue[];
  readonly ids: Set<string>;
  readonly targets: Set<string>;
  readonly targetReferences: { readonly id: string; readonly path: string }[];
}

function addIssue(
  context: ValidationContext,
  path: string,
  code: string,
  message: string
): void {
  context.issues.push({ path, code, message });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactFields(
  value: Record<string, unknown>,
  path: string,
  required: readonly string[],
  optional: readonly string[],
  context: ValidationContext
): boolean {
  const allowed = new Set([...required, ...optional]);
  let valid = true;

  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      addIssue(
        context,
        `${path}.${key}`,
        "missing-field",
        `Required field "${key}" is missing.`
      );
      valid = false;
    }
  }

  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      addIssue(
        context,
        `${path}.${key}`,
        "unknown-field",
        `Field "${key}" is not allowed here.`
      );
      valid = false;
    }
  }

  return valid;
}

function readStableId(
  value: unknown,
  path: string,
  context: ValidationContext
): string | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 128 ||
    !ID_PATTERN.test(value)
  ) {
    addIssue(
      context,
      path,
      "invalid-identifier",
      "Expected a stable lowercase identifier."
    );
    return null;
  }
  return value;
}

function readSymbol(
  value: unknown,
  path: string,
  context: ValidationContext
): string | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 128 ||
    !SYMBOL_PATTERN.test(value)
  ) {
    addIssue(
      context,
      path,
      "invalid-symbol",
      "Expected a lowercase symbolic identifier."
    );
    return null;
  }
  return value;
}

function readText(
  value: unknown,
  path: string,
  context: ValidationContext
): string | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 200 ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    addIssue(
      context,
      path,
      "invalid-text",
      "Expected nonempty text with at most 200 characters and no control characters."
    );
    return null;
  }
  return value;
}

function readNonnegativeInteger(
  value: unknown,
  path: string,
  context: ValidationContext
): number | null {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    addIssue(
      context,
      path,
      "invalid-integer",
      "Expected a safe nonnegative integer."
    );
    return null;
  }
  return value;
}

function readMoveZone(
  value: unknown,
  path: string,
  context: ValidationContext
): FullProductMoveZone | null {
  if (value !== "discard") {
    addIssue(context, path, "invalid-zone", 'Expected the verified zone "discard".');
    return null;
  }
  return value;
}

function registerNodeId(
  id: string | null,
  path: string,
  context: ValidationContext
): void {
  if (id === null) {
    return;
  }
  if (context.ids.has(id)) {
    addIssue(context, path, "duplicate-node-id", `Node id "${id}" is already used.`);
  }
  context.ids.add(id);
}

function validateArguments(
  value: unknown,
  spec: FullProductEffectOpcodeSpec,
  path: string,
  context: ValidationContext
): FullProductJsonObject | null {
  if (!isPlainObject(value)) {
    addIssue(context, path, "invalid-arguments", "Expected a JSON object.");
    return null;
  }

  let valid = true;
  const knownKeys = new Set(spec.arguments.map(argument => argument.key));
  for (const key of Object.keys(value)) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") {
      addIssue(
        context,
        `${path}.${key}`,
        "unsafe-key",
        `JSON object key "${key}" is not allowed.`
      );
      valid = false;
      continue;
    }
    if (!knownKeys.has(key)) {
      addIssue(
        context,
        `${path}.${key}`,
        "unknown-argument",
        `Argument "${key}" is not defined for opcode "${spec.opcode}".`
      );
      valid = false;
    }
  }

  const normalized: Record<string, FullProductJsonValue> = {};
  for (const argument of spec.arguments) {
    if (!Object.prototype.hasOwnProperty.call(value, argument.key)) {
      addIssue(
        context,
        `${path}.${argument.key}`,
        "missing-argument",
        `Required argument "${argument.key}" is missing.`
      );
      valid = false;
      continue;
    }

    const candidate = value[argument.key];
    if (argument.type === "nonnegative-integer") {
      const parsed = readNonnegativeInteger(candidate, `${path}.${argument.key}`, context);
      if (parsed === null) {
        valid = false;
      } else {
        normalized[argument.key] = parsed;
      }
    } else if (argument.type === "move-zone") {
      const parsed = readMoveZone(candidate, `${path}.${argument.key}`, context);
      if (parsed === null) {
        valid = false;
      } else {
        normalized[argument.key] = parsed;
      }
    } else {
      const parsed = readText(candidate, `${path}.${argument.key}`, context);
      if (parsed === null) {
        valid = false;
      } else {
        normalized[argument.key] = parsed;
      }
    }
  }

  return valid ? normalized : null;
}

function validateTargetNode(
  value: Record<string, unknown>,
  path: string,
  context: ValidationContext
): FullProductEffectIrTarget | null {
  if (
    !hasExactFields(
      value,
      path,
      ["type", "id", "placeholder", "minCount", "maxCount"],
      [],
      context
    )
  ) {
    return null;
  }

  const id = readStableId(value.id, `${path}.id`, context);
  registerNodeId(id, `${path}.id`, context);
  const placeholder = readSymbol(value.placeholder, `${path}.placeholder`, context);
  const minCount = readNonnegativeInteger(value.minCount, `${path}.minCount`, context);
  const maxCount =
    value.maxCount === null
      ? null
      : readNonnegativeInteger(value.maxCount, `${path}.maxCount`, context);

  if (
    minCount !== null &&
    maxCount !== null &&
    minCount > maxCount
  ) {
    addIssue(context, path, "invalid-range", "minCount may not be greater than maxCount.");
  }

  if (
    id === null ||
    placeholder === null ||
    minCount === null ||
    maxCount === undefined
  ) {
    return null;
  }
  if (context.targets.has(id)) {
    addIssue(
      context,
      `${path}.id`,
      "duplicate-target-id",
      `Target id "${id}" is already used.`
    );
  } else {
    context.targets.add(id);
  }

  return { type: "target", id, placeholder, minCount, maxCount };
}

function validateEffectNode(
  value: Record<string, unknown>,
  path: string,
  context: ValidationContext
): FullProductEffectIrEffect | null {
  if (
    !hasExactFields(
      value,
      path,
      ["type", "id", "opcode", "args"],
      ["targetId"],
      context
    )
  ) {
    return null;
  }

  const id = readStableId(value.id, `${path}.id`, context);
  registerNodeId(id, `${path}.id`, context);

  if (
    typeof value.opcode !== "string" ||
    !FULL_PRODUCT_EFFECT_OPCODES.includes(value.opcode as FullProductEffectOpcode)
  ) {
    addIssue(
      context,
      `${path}.opcode`,
      "unknown-opcode",
      `Expected one of: ${FULL_PRODUCT_EFFECT_OPCODES.join(", ")}.`
    );
    return null;
  }

  const opcode = value.opcode as FullProductEffectOpcode;
  const spec = FULL_PRODUCT_EFFECT_OPCODE_SPECS[opcode];
  const args = validateArguments(value.args, spec, `${path}.args`, context);
  const hasTargetId = Object.prototype.hasOwnProperty.call(value, "targetId");
  const targetId = hasTargetId
    ? readStableId(value.targetId, `${path}.targetId`, context)
    : undefined;

  if (spec.requiresTarget && !hasTargetId) {
    addIssue(
      context,
      `${path}.targetId`,
      "missing-target",
      `Opcode "${opcode}" requires a target reference.`
    );
  }
  if (!spec.requiresTarget && hasTargetId) {
    addIssue(
      context,
      `${path}.targetId`,
      "unexpected-target",
      `Opcode "${opcode}" does not accept a target reference.`
    );
  }
  if (targetId !== undefined && targetId !== null) {
    context.targetReferences.push({ id: targetId, path: `${path}.targetId` });
  }

  if (id === null || args === null || (hasTargetId && targetId === null)) {
    return null;
  }

  return targetId === undefined
    ? { type: "effect", id, opcode, args }
    : { type: "effect", id, opcode, args, targetId: targetId as string };
}

function validateTriggerNode(
  value: Record<string, unknown>,
  path: string,
  context: ValidationContext
): FullProductEffectIrTrigger | null {
  if (!hasExactFields(value, path, ["type", "id", "event", "body"], [], context)) {
    return null;
  }

  const id = readStableId(value.id, `${path}.id`, context);
  registerNodeId(id, `${path}.id`, context);
  const event = readSymbol(value.event, `${path}.event`, context);

  if (!Array.isArray(value.body) || value.body.length === 0) {
    addIssue(
      context,
      `${path}.body`,
      "invalid-body",
      "Expected a nonempty array of EffectIR nodes."
    );
    return null;
  }

  if (id === null || event === null) {
    return null;
  }

  const body: FullProductEffectIrNode[] = [];
  value.body.forEach((item, index) => {
    const node = validateNode(item, `${path}.body[${index}]`, context);
    if (node !== null) {
      body.push(node);
    }
  });

  if (body.length !== value.body.length) {
    return null;
  }
  return { type: "trigger", id, event, body };
}

function validateNode(
  value: unknown,
  path: string,
  context: ValidationContext
): FullProductEffectIrNode | null {
  if (!isPlainObject(value)) {
    addIssue(context, path, "invalid-node", "Expected a plain EffectIR node object.");
    return null;
  }

  if (value.type === "target") {
    return validateTargetNode(value, path, context);
  }
  if (value.type === "effect") {
    return validateEffectNode(value, path, context);
  }
  if (value.type === "trigger") {
    return validateTriggerNode(value, path, context);
  }

  addIssue(
    context,
    `${path}.type`,
    "unknown-node-type",
    'Expected "target", "effect", or "trigger".'
  );
  return null;
}

export function validateFullProductEffectIr(
  input: unknown
): FullProductEffectIrValidationResult {
  if (!isPlainObject(input)) {
    return {
      ok: false,
      issues: [
        {
          path: "$",
          code: "invalid-document",
          message: "Expected a plain full-product EffectIR object."
        }
      ]
    };
  }

  const context: ValidationContext = {
    issues: [],
    ids: new Set<string>(),
    targets: new Set<string>(),
    targetReferences: []
  };

  if (
    !hasExactFields(
      input,
      "$",
      ["kind", "schemaVersion", "ruleset", "id", "body"],
      [],
      context
    )
  ) {
    return { ok: false, issues: context.issues };
  }

  if (input.kind !== FULL_PRODUCT_EFFECT_IR_KIND) {
    addIssue(context, "$.kind", "invalid-kind", 'Expected "full-product-effect-ir".');
  }
  if (input.schemaVersion !== FULL_PRODUCT_EFFECT_IR_SCHEMA_VERSION) {
    addIssue(
      context,
      "$.schemaVersion",
      "unsupported-schema-version",
      `Expected schema version ${FULL_PRODUCT_EFFECT_IR_SCHEMA_VERSION}.`
    );
  }
  if (input.ruleset !== FULL_PRODUCT_EFFECT_IR_RULESET) {
    addIssue(
      context,
      "$.ruleset",
      "unsupported-ruleset",
      `Expected ruleset "${FULL_PRODUCT_EFFECT_IR_RULESET}".`
    );
  }

  const id = readStableId(input.id, "$.id", context);
  if (!Array.isArray(input.body) || input.body.length === 0) {
    addIssue(
      context,
      "$.body",
      "invalid-body",
      "Expected a nonempty array of EffectIR nodes."
    );
  }

  const body: FullProductEffectIrNode[] = [];
  if (Array.isArray(input.body)) {
    input.body.forEach((item, index) => {
      const node = validateNode(item, `$.body[${index}]`, context);
      if (node !== null) {
        body.push(node);
      }
    });
  }

  for (const reference of context.targetReferences) {
    if (!context.targets.has(reference.id)) {
      addIssue(
        context,
        reference.path,
        "unresolved-target",
        `Target id "${reference.id}" does not exist.`
      );
    }
  }

  if (
    context.issues.length > 0 ||
    id === null ||
    !Array.isArray(input.body) ||
    body.length !== input.body.length
  ) {
    return { ok: false, issues: context.issues };
  }

  return {
    ok: true,
    issues: [],
    value: {
      kind: FULL_PRODUCT_EFFECT_IR_KIND,
      schemaVersion: FULL_PRODUCT_EFFECT_IR_SCHEMA_VERSION,
      ruleset: FULL_PRODUCT_EFFECT_IR_RULESET,
      id,
      body
    }
  };
}

export function parseFullProductEffectIr(input: unknown): FullProductEffectIr {
  const result = validateFullProductEffectIr(input);
  if (!result.ok) {
    throw new FullProductEffectIrValidationError(result.issues);
  }
  return result.value;
}

export function isFullProductEffectIr(
  input: unknown
): input is FullProductEffectIr {
  return validateFullProductEffectIr(input).ok;
}

export interface FullProductEffectTextCompilationInput {
  readonly id: string;
  readonly text: string;
}

export type FullProductEffectTextDiagnosticCode = "empty-text" | "judge-required";

export interface FullProductEffectTextDiagnostic {
  readonly path: string;
  readonly code: FullProductEffectTextDiagnosticCode;
  readonly message: string;
}

export type FullProductEffectTextCompilationResult =
  | {
      readonly status: "executable";
      readonly ir: FullProductEffectIr;
      readonly issues: readonly [];
    }
  | {
      readonly status: "judgeRequired";
      readonly ir: null;
      readonly issues: readonly FullProductEffectTextDiagnostic[];
    };

interface VerifiedTextRule {
  readonly opcode: FullProductEffectOpcode;
  readonly args: FullProductJsonObject;
}

const VERIFIED_TEXT_RULES = new Map<string, VerifiedTextRule>([
  ["draw 1 card", { opcode: "draw.cards", args: { count: 1 } }],
  ["gain 1 energy", { opcode: "gain.energy", args: { amount: 1 } }],
  ["gain 1 score", { opcode: "gain.score", args: { amount: 1 } }],
  ["move this card to discard", { opcode: "move.zone", args: { zone: "discard" } }],
  ["create 1 chain item", { opcode: "chain.create", args: { count: 1 } }]
]);

function normalizeVerifiedText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.]$/, "");
}

function hasExactInputFields(
  value: Record<string, unknown>
): value is { id: unknown; text: unknown } {
  const keys = Object.keys(value);
  return keys.length === 2 && keys.includes("id") && keys.includes("text");
}

export function compileFullProductEffectText(
  input: FullProductEffectTextCompilationInput
): FullProductEffectTextCompilationResult {
  if (
    !isPlainObject(input) ||
    !hasExactInputFields(input) ||
    typeof input.id !== "string" ||
    input.id.length === 0 ||
    input.id.length > 128 ||
    !ID_PATTERN.test(input.id)
  ) {
    throw new FullProductEffectIrValidationError([
      {
        path: "$.id",
        code: "invalid-identifier",
        message: "Expected a stable lowercase card id."
      }
    ]);
  }
  if (typeof input.text !== "string") {
    throw new FullProductEffectIrValidationError([
      {
        path: `${input.id}.ability`,
        code: "invalid-text",
        message: "Expected card effect text as a string."
      }
    ]);
  }

  const normalized = normalizeVerifiedText(input.text);
  if (normalized === "") {
    return {
      status: "judgeRequired",
      ir: null,
      issues: [
        {
          path: `${input.id}.ability`,
          code: "empty-text",
          message: "No ability text is available to compile."
        }
      ]
    };
  }

  const rule = VERIFIED_TEXT_RULES.get(normalized);
  if (rule === undefined) {
    return {
      status: "judgeRequired",
      ir: null,
      issues: [
        {
          path: `${input.id}.ability`,
          code: "judge-required",
          message:
            "The ability text is outside the explicitly verified full-product compiler coverage."
        }
      ]
    };
  }

  const candidate: FullProductEffectIr = {
    kind: FULL_PRODUCT_EFFECT_IR_KIND,
    schemaVersion: FULL_PRODUCT_EFFECT_IR_SCHEMA_VERSION,
    ruleset: FULL_PRODUCT_EFFECT_IR_RULESET,
    id: input.id,
    body: [
      {
        type: "effect",
        id: `${input.id}.effect`,
        opcode: rule.opcode,
        args: rule.args
      }
    ]
  };

  const result = validateFullProductEffectIr(candidate);
  if (!result.ok) {
    throw new FullProductEffectIrValidationError(result.issues);
  }
  return { status: "executable", ir: result.value, issues: [] };
}

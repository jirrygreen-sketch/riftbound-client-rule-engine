export const CARD_DSL_KIND = "card-dsl" as const;
export const CARD_DSL_SCHEMA_VERSION = 1 as const;
export const SYNTHETIC_DEMO_RULESET = "synthetic-demo" as const;
export const EFFECT_IR_SCHEMA_VERSION = 1 as const;

export * from "./ir/index.js";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];

export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export interface EffectNode {
  readonly type: "effect";
  readonly id: string;
  readonly operation: string;
  readonly arguments: JsonObject;
  readonly targetId?: string;
}

export interface TriggerNode {
  readonly type: "trigger";
  readonly id: string;
  readonly event: string;
  readonly filter?: JsonObject;
  readonly body: readonly CardDslNode[];
}

export interface ChoiceOption {
  readonly id: string;
  readonly label: string;
  readonly body: readonly CardDslNode[];
}

export interface ChoiceNode {
  readonly type: "choice";
  readonly id: string;
  readonly prompt: string;
  readonly options: readonly ChoiceOption[];
  readonly defaultOptionId?: string;
}

export interface OptionalNode {
  readonly type: "optional";
  readonly id: string;
  readonly prompt: string;
  readonly body: readonly CardDslNode[];
  readonly decline: readonly CardDslNode[];
}

export interface AutoResolveNode {
  readonly type: "auto-resolve";
  readonly id: string;
  readonly body: readonly CardDslNode[];
}

export interface TargetNode {
  readonly type: "target";
  readonly id: string;
  readonly placeholder: string;
  readonly minCount: number;
  readonly maxCount: number | null;
}

export type CardDslNode =
  | EffectNode
  | TriggerNode
  | ChoiceNode
  | OptionalNode
  | AutoResolveNode
  | TargetNode;

export interface CardDslDocument {
  readonly kind: typeof CARD_DSL_KIND;
  readonly schemaVersion: typeof CARD_DSL_SCHEMA_VERSION;
  readonly ruleset: typeof SYNTHETIC_DEMO_RULESET;
  readonly id: string;
  readonly body: readonly CardDslNode[];
}

export interface ValidationIssue {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

export type ValidationResult =
  | {
      readonly ok: true;
      readonly value: CardDslDocument;
      readonly issues: readonly [];
    }
  | {
      readonly ok: false;
      readonly issues: readonly ValidationIssue[];
    };

export class CardDslValidationError extends Error {
  readonly issues: readonly ValidationIssue[];

  constructor(issues: readonly ValidationIssue[]) {
    super(formatIssues(issues));
    this.name = "CardDslValidationError";
    this.issues = issues;
  }
}

const NODE_TYPES = new Set([
  "effect",
  "trigger",
  "choice",
  "optional",
  "auto-resolve",
  "target"
]);

const ID_PATTERN = /^[a-z][a-z0-9._-]*$/;
const SYMBOL_PATTERN = /^[a-z][a-z0-9._:-]*$/;

interface ValidationContext {
  readonly issues: ValidationIssue[];
  readonly nodeIds: Set<string>;
  readonly targetIds: Set<string>;
  readonly targetReferences: { readonly id: string; readonly path: string }[];
  readonly ancestors: WeakSet<object>;
  autoResolveDepth: number;
}

function formatIssues(issues: readonly ValidationIssue[]): string {
  return issues
    .map(issue => `${issue.path}: ${issue.message}`)
    .join("\n");
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

function isJsonObjectValue(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(
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
      addIssue(context, `${path}.${key}`, "missing-field", `Required field "${key}" is missing.`);
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

function readString(
  value: unknown,
  path: string,
  context: ValidationContext,
  options: {
    readonly pattern?: RegExp;
    readonly maxLength?: number;
    readonly description?: string;
  } = {}
): string | null {
  const maxLength = options.maxLength ?? 160;
  const description = options.description ?? "nonempty string";

  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
    addIssue(
      context,
      path,
      "invalid-string",
      `Expected ${description} with at most ${maxLength} characters.`
    );
    return null;
  }

  if (options.pattern && !options.pattern.test(value)) {
    addIssue(
      context,
      path,
      "invalid-identifier",
      "Expected a lowercase identifier beginning with a letter and containing only letters, digits, dots, underscores, hyphens, or colons."
    );
    return null;
  }

  return value;
}

function readIndex(
  value: unknown,
  path: string,
  context: ValidationContext,
  options: {
    readonly minimum: number;
    readonly nullable?: boolean;
  }
): number | null | undefined {
  if (value === null && options.nullable) {
    return null;
  }

  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < options.minimum
  ) {
    addIssue(
      context,
      path,
      "invalid-count",
      `Expected a safe integer greater than or equal to ${options.minimum}${options.nullable ? " or null" : ""}.`
    );
    return undefined;
  }

  return value;
}

function readBoolean(
  value: unknown,
  path: string,
  context: ValidationContext
): boolean | null {
  if (typeof value !== "boolean") {
    addIssue(context, path, "invalid-boolean", "Expected a boolean.");
    return null;
  }

  return value;
}

function readArray(
  value: unknown,
  path: string,
  context: ValidationContext,
  minimumLength: number
): readonly unknown[] | null {
  if (!Array.isArray(value)) {
    addIssue(context, path, "invalid-array", "Expected an array.");
    return null;
  }

  if (value.length < minimumLength) {
    addIssue(
      context,
      path,
      "array-too-short",
      `Expected at least ${minimumLength} item${minimumLength === 1 ? "" : "s"}.`
    );
    return null;
  }

  return value;
}

function readJsonObject(
  value: unknown,
  path: string,
  context: ValidationContext
): JsonObject | null {
  const normalized = normalizeJsonValue(value, path, context, 0);
  if (!isJsonObjectValue(normalized)) {
    if (normalized !== undefined) {
      addIssue(context, path, "invalid-object", "Expected a JSON object.");
    }
    return null;
  }

  return normalized;
}

function normalizeJsonValue(
  value: unknown,
  path: string,
  context: ValidationContext,
  depth: number
): JsonValue | undefined {
  if (depth > 32) {
    addIssue(context, path, "json-too-deep", "JSON data may not exceed 32 levels.");
    return undefined;
  }

  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      addIssue(context, path, "invalid-number", "JSON numbers must be finite.");
      return undefined;
    }
    return value;
  }

  if (Array.isArray(value)) {
    if (context.ancestors.has(value)) {
      addIssue(context, path, "cyclic-value", "Cyclic data is not valid JSON.");
      return undefined;
    }

    context.ancestors.add(value);
    const normalized: JsonValue[] = [];
    value.forEach((item, index) => {
      const child = normalizeJsonValue(item, `${path}[${index}]`, context, depth + 1);
      if (child !== undefined) {
        normalized.push(child);
      }
    });
    context.ancestors.delete(value);
    return normalized;
  }

  if (!isRecord(value)) {
    addIssue(
      context,
      path,
      "non-json-value",
      "Expected a JSON primitive, array, or plain object."
    );
    return undefined;
  }

  if (context.ancestors.has(value)) {
    addIssue(context, path, "cyclic-value", "Cyclic data is not valid JSON.");
    return undefined;
  }

  context.ancestors.add(value);
  const normalized: Record<string, JsonValue> = {};
  for (const key of Object.keys(value)) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") {
      addIssue(
        context,
        `${path}.${key}`,
        "unsafe-key",
        `JSON object key "${key}" is not allowed.`
      );
      continue;
    }

    const child = normalizeJsonValue(value[key], `${path}.${key}`, context, depth + 1);
    if (child !== undefined) {
      normalized[key] = child;
    }
  }
  context.ancestors.delete(value);
  return normalized;
}

function registerNodeId(
  id: string | null,
  path: string,
  context: ValidationContext
): void {
  if (id === null) {
    return;
  }

  if (context.nodeIds.has(id)) {
    addIssue(context, path, "duplicate-node-id", `Node id "${id}" is already used.`);
    return;
  }

  context.nodeIds.add(id);
}

function readBody(
  value: unknown,
  path: string,
  context: ValidationContext,
  minimumLength: number
): readonly CardDslNode[] | null {
  const items = readArray(value, path, context, minimumLength);
  if (items === null) {
    return null;
  }

  const body: CardDslNode[] = [];
  items.forEach((item, index) => {
    const node = readNode(item, `${path}[${index}]`, context);
    if (node !== null) {
      body.push(node);
    }
  });
  return body;
}

function readOptionalField(
  value: Record<string, unknown>,
  key: string,
  path: string,
  context: ValidationContext,
  reader: (value: unknown, path: string) => JsonObject | null
): JsonObject | undefined {
  if (!Object.prototype.hasOwnProperty.call(value, key)) {
    return undefined;
  }

  const result = reader(value[key], `${path}.${key}`);
  return result === null ? undefined : result;
}

function readEffectNode(
  value: Record<string, unknown>,
  path: string,
  context: ValidationContext
): EffectNode | null {
  hasOnlyKeys(value, path, ["type", "id", "operation", "arguments"], ["targetId"], context);

  const id = readString(value.id, `${path}.id`, context, { pattern: ID_PATTERN });
  registerNodeId(id, `${path}.id`, context);
  const operation = readString(value.operation, `${path}.operation`, context, {
    pattern: SYMBOL_PATTERN
  });
  const argumentsValue = readJsonObject(value.arguments, `${path}.arguments`, context);
  const targetId = Object.prototype.hasOwnProperty.call(value, "targetId")
    ? readString(value.targetId, `${path}.targetId`, context, { pattern: ID_PATTERN })
    : undefined;

  if (targetId !== undefined && targetId !== null) {
    if (context.autoResolveDepth > 0) {
      addIssue(
        context,
        `${path}.targetId`,
        "auto-resolve-target",
        "Target selection requires a player decision and cannot be automated."
      );
    }
    context.targetReferences.push({ id: targetId, path: `${path}.targetId` });
  }

  if (id === null || operation === null || argumentsValue === null) {
    return null;
  }

  return targetId === null || targetId === undefined
    ? { type: "effect", id, operation, arguments: argumentsValue }
    : { type: "effect", id, operation, arguments: argumentsValue, targetId };
}

function readTriggerNode(
  value: Record<string, unknown>,
  path: string,
  context: ValidationContext
): TriggerNode | null {
  hasOnlyKeys(value, path, ["type", "id", "event", "body"], ["filter"], context);

  const id = readString(value.id, `${path}.id`, context, { pattern: ID_PATTERN });
  registerNodeId(id, `${path}.id`, context);
  const event = readString(value.event, `${path}.event`, context, {
    pattern: SYMBOL_PATTERN
  });
  const filter = readOptionalField(value, "filter", path, context, (candidate, childPath) =>
    readJsonObject(candidate, childPath, context)
  );
  const body = readBody(value.body, `${path}.body`, context, 1);

  if (id === null || event === null || body === null) {
    return null;
  }

  return filter === undefined
    ? { type: "trigger", id, event, body }
    : { type: "trigger", id, event, filter, body };
}

function readChoiceOption(
  value: unknown,
  path: string,
  context: ValidationContext
): ChoiceOption | null {
  if (!isRecord(value)) {
    addIssue(context, path, "invalid-object", "Expected a choice option object.");
    return null;
  }

  hasOnlyKeys(value, path, ["id", "label", "body"], [], context);
  const id = readString(value.id, `${path}.id`, context, { pattern: ID_PATTERN });
  const label = readString(value.label, `${path}.label`, context, { maxLength: 200 });
  const body = readBody(value.body, `${path}.body`, context, 1);

  if (id === null || label === null || body === null) {
    return null;
  }

  return { id, label, body };
}

function readChoiceNode(
  value: Record<string, unknown>,
  path: string,
  context: ValidationContext
): ChoiceNode | null {
  hasOnlyKeys(value, path, ["type", "id", "prompt", "options"], ["defaultOptionId"], context);

  const id = readString(value.id, `${path}.id`, context, { pattern: ID_PATTERN });
  registerNodeId(id, `${path}.id`, context);
  const prompt = readString(value.prompt, `${path}.prompt`, context, { maxLength: 200 });
  const optionValues = readArray(value.options, `${path}.options`, context, 2);
  const options: ChoiceOption[] = [];
  const optionIds = new Set<string>();

  if (optionValues !== null) {
    optionValues.forEach((optionValue, index) => {
      const option = readChoiceOption(optionValue, `${path}.options[${index}]`, context);
      if (option === null) {
        return;
      }

      if (optionIds.has(option.id)) {
        addIssue(
          context,
          `${path}.options[${index}].id`,
          "duplicate-option-id",
          `Choice option id "${option.id}" is already used in this choice.`
        );
        return;
      }

      optionIds.add(option.id);
      options.push(option);
    });
  }

  const defaultOptionId = Object.prototype.hasOwnProperty.call(value, "defaultOptionId")
    ? readString(value.defaultOptionId, `${path}.defaultOptionId`, context, { pattern: ID_PATTERN })
    : undefined;

  if (defaultOptionId !== undefined && defaultOptionId !== null && !optionIds.has(defaultOptionId)) {
    addIssue(
      context,
      `${path}.defaultOptionId`,
      "unknown-default-option",
      `Default option "${defaultOptionId}" does not exist in this choice.`
    );
  }

  if (id === null || prompt === null || optionValues === null || options.length < 2) {
    return null;
  }

  return defaultOptionId === null || defaultOptionId === undefined
    ? { type: "choice", id, prompt, options }
    : { type: "choice", id, prompt, options, defaultOptionId };
}

function readOptionalNode(
  value: Record<string, unknown>,
  path: string,
  context: ValidationContext
): OptionalNode | null {
  hasOnlyKeys(value, path, ["type", "id", "prompt", "body", "decline"], [], context);

  const id = readString(value.id, `${path}.id`, context, { pattern: ID_PATTERN });
  registerNodeId(id, `${path}.id`, context);
  const prompt = readString(value.prompt, `${path}.prompt`, context, { maxLength: 200 });
  const body = readBody(value.body, `${path}.body`, context, 1);
  const decline = readBody(value.decline, `${path}.decline`, context, 0);

  if (id === null || prompt === null || body === null || decline === null) {
    return null;
  }

  return { type: "optional", id, prompt, body, decline };
}

function readAutoResolveNode(
  value: Record<string, unknown>,
  path: string,
  context: ValidationContext
): AutoResolveNode | null {
  hasOnlyKeys(value, path, ["type", "id", "body"], [], context);

  const id = readString(value.id, `${path}.id`, context, { pattern: ID_PATTERN });
  registerNodeId(id, `${path}.id`, context);

  context.autoResolveDepth += 1;
  const body = readBody(value.body, `${path}.body`, context, 1);
  context.autoResolveDepth -= 1;

  if (id === null || body === null) {
    return null;
  }

  return { type: "auto-resolve", id, body };
}

function readTargetNode(
  value: Record<string, unknown>,
  path: string,
  context: ValidationContext
): TargetNode | null {
  hasOnlyKeys(value, path, ["type", "id", "placeholder", "minCount", "maxCount"], [], context);

  const id = readString(value.id, `${path}.id`, context, { pattern: ID_PATTERN });
  registerNodeId(id, `${path}.id`, context);
  const placeholder = readString(value.placeholder, `${path}.placeholder`, context, {
    pattern: SYMBOL_PATTERN
  });
  const minCount = readIndex(value.minCount, `${path}.minCount`, context, { minimum: 0 });
  const maxCount = readIndex(value.maxCount, `${path}.maxCount`, context, {
    minimum: 0,
    nullable: true
  });

  if (
    typeof minCount === "number" &&
    typeof maxCount === "number" &&
    minCount > maxCount
  ) {
    addIssue(
      context,
      path,
      "invalid-range",
      "minCount may not be greater than maxCount."
    );
  }

  if (
    id === null ||
    placeholder === null ||
    minCount === null ||
    minCount === undefined ||
    maxCount === undefined
  ) {
    return null;
  }

  if (context.targetIds.has(id)) {
    addIssue(context, `${path}.id`, "duplicate-target-id", `Target id "${id}" is already used.`);
  } else {
    context.targetIds.add(id);
  }

  return { type: "target", id, placeholder, minCount, maxCount };
}

function readNode(
  value: unknown,
  path: string,
  context: ValidationContext
): CardDslNode | null {
  if (!isRecord(value)) {
    addIssue(context, path, "invalid-node", "Expected an AST node object.");
    return null;
  }

  if (typeof value.type !== "string" || !NODE_TYPES.has(value.type)) {
    addIssue(
      context,
      `${path}.type`,
      "unknown-node-type",
      `Expected one of: ${[...NODE_TYPES].join(", ")}.`
    );
    return null;
  }

  if (context.autoResolveDepth > 0 &&
      (value.type === "choice" || value.type === "optional")) {
    addIssue(
      context,
      `${path}.type`,
      "auto-resolve-choice",
      "A strategy choice cannot be nested inside an auto-resolve body."
    );
    return null;
  }

  if (context.autoResolveDepth > 0 && value.type === "target") {
    addIssue(
      context,
      `${path}.type`,
      "auto-resolve-target",
      "A target node cannot be nested inside an auto-resolve body."
    );
    return null;
  }

  switch (value.type) {
    case "effect":
      return readEffectNode(value, path, context);
    case "trigger":
      return readTriggerNode(value, path, context);
    case "choice":
      return readChoiceNode(value, path, context);
    case "optional":
      return readOptionalNode(value, path, context);
    case "auto-resolve":
      return readAutoResolveNode(value, path, context);
    case "target":
      return readTargetNode(value, path, context);
  }

  return null;
}

function readDocument(value: unknown): ValidationResult {
  const context: ValidationContext = {
    issues: [],
    nodeIds: new Set(),
    targetIds: new Set(),
    targetReferences: [],
    ancestors: new WeakSet(),
    autoResolveDepth: 0
  };

  if (!isRecord(value)) {
    addIssue(context, "$", "invalid-document", "Expected a card DSL document object.");
    return { ok: false, issues: context.issues };
  }

  hasOnlyKeys(
    value,
    "$",
    ["kind", "schemaVersion", "ruleset", "id", "body"],
    [],
    context
  );

  if (value.kind !== CARD_DSL_KIND) {
    addIssue(context, "$.kind", "invalid-kind", `Expected "${CARD_DSL_KIND}".`);
  }
  if (value.schemaVersion !== CARD_DSL_SCHEMA_VERSION) {
    addIssue(
      context,
      "$.schemaVersion",
      "unsupported-schema-version",
      `Expected schema version ${CARD_DSL_SCHEMA_VERSION}.`
    );
  }
  if (value.ruleset !== SYNTHETIC_DEMO_RULESET) {
    addIssue(
      context,
      "$.ruleset",
      "unsupported-ruleset",
      `Expected ruleset "${SYNTHETIC_DEMO_RULESET}".`
    );
  }

  const id = readString(value.id, "$.id", context, { pattern: ID_PATTERN });
  const body = readBody(value.body, "$.body", context, 1);

  for (const reference of context.targetReferences) {
    if (!context.targetIds.has(reference.id)) {
      addIssue(
        context,
        reference.path,
        "unresolved-target",
        `Target id "${reference.id}" does not refer to a target node in this document.`
      );
    }
  }

  if (context.issues.length > 0 || id === null || body === null) {
    return { ok: false, issues: context.issues };
  }

  return {
    ok: true,
    value: {
      kind: CARD_DSL_KIND,
      schemaVersion: CARD_DSL_SCHEMA_VERSION,
      ruleset: SYNTHETIC_DEMO_RULESET,
      id,
      body
    },
    issues: []
  };
}

export function validateCardDsl(input: unknown): ValidationResult {
  return readDocument(input);
}

export function isCardDsl(input: unknown): input is CardDslDocument {
  return validateCardDsl(input).ok;
}

export function parseCardDsl(input: unknown): CardDslDocument {
  const result = validateCardDsl(input);
  if (!result.ok) {
    throw new CardDslValidationError(result.issues);
  }
  return result.value;
}

function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return JSON.stringify(value);
  }

  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }

  const objectValue = value as JsonObject;
  const entries = Object.keys(objectValue)
    .sort()
    .map(key => `${JSON.stringify(key)}:${canonicalJson(objectValue[key]!)}`);
  return `{${entries.join(",")}}`;
}

export function serializeCardDsl(input: unknown): string {
  return canonicalJson(parseCardDsl(input) as unknown as JsonValue);
}

export function stableHashCardDsl(input: unknown): string {
  const bytes = new TextEncoder().encode(serializeCardDsl(input));
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;

  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * prime);
  }

  return `fnv1a64:${hash.toString(16).padStart(16, "0")}`;
}

export type EffectOpcode =
  | "draw.cards"
  | "damage.target"
  | "gain.energy"
  | "summon.self";

export const EFFECT_OPCODES = [
  "draw.cards",
  "damage.target",
  "gain.energy",
  "summon.self"
] as const satisfies readonly EffectOpcode[];

export interface EffectArgumentSpec {
  readonly key: string;
  readonly required: boolean;
  readonly type: "integer" | "player";
}

export interface EffectOpcodeSpec {
  readonly operation: EffectOpcode;
  readonly arguments: readonly EffectArgumentSpec[];
  readonly requiresTarget: boolean;
}

export const EFFECT_OPCODE_SPECS: Readonly<
  Record<EffectOpcode, EffectOpcodeSpec>
> = {
  "draw.cards": {
    operation: "draw.cards",
    arguments: [{ key: "count", required: true, type: "integer" }],
    requiresTarget: false
  },
  "damage.target": {
    operation: "damage.target",
    arguments: [{ key: "amount", required: true, type: "integer" }],
    requiresTarget: true
  },
  "gain.energy": {
    operation: "gain.energy",
    arguments: [
      { key: "amount", required: true, type: "integer" },
      { key: "player", required: true, type: "player" }
    ],
    requiresTarget: false
  },
  "summon.self": {
    operation: "summon.self",
    arguments: [],
    requiresTarget: false
  }
};

export interface EffectIrEffect {
  readonly type: "effect";
  readonly id: string;
  readonly opcode: EffectOpcode;
  readonly args: JsonObject;
  readonly targetId?: string;
}

export interface EffectIrTrigger {
  readonly type: "trigger";
  readonly id: string;
  readonly event: string;
  readonly body: readonly EffectIrNode[];
}

export interface EffectIrTarget {
  readonly type: "target";
  readonly id: string;
  readonly placeholder: string;
  readonly minCount: number;
  readonly maxCount: number | null;
}

export type EffectIrNode = EffectIrEffect | EffectIrTrigger | EffectIrTarget;

export interface EffectIr {
  readonly kind: "effect-ir";
  readonly schemaVersion: typeof EFFECT_IR_SCHEMA_VERSION;
  readonly ruleset: typeof SYNTHETIC_DEMO_RULESET;
  readonly id: string;
  readonly body: readonly EffectIrNode[];
}

export interface EffectIrValidationIssue {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

export type EffectIrValidationResult =
  | {
      readonly ok: true;
      readonly value: EffectIr;
      readonly issues: readonly [];
    }
  | {
      readonly ok: false;
      readonly issues: readonly EffectIrValidationIssue[];
    };

export class EffectIrValidationError extends Error {
  readonly issues: readonly EffectIrValidationIssue[];

  constructor(issues: readonly EffectIrValidationIssue[]) {
    super(
      issues.map(issue => `${issue.path}: ${issue.message}`).join("\n")
    );
    this.name = "EffectIrValidationError";
    this.issues = issues;
  }
}

export interface EffectTextDiagnostic {
  readonly path: string;
  readonly code: "empty-text" | "judge-required";
  readonly message: string;
}

export type EffectTextCompilationResult =
  | {
      readonly status: "executable";
      readonly ir: EffectIr;
      readonly issues: readonly [];
    }
  | {
      readonly status: "judgeRequired";
      readonly ir: null;
      readonly issues: readonly EffectTextDiagnostic[];
    };

export interface EffectTextCompilationInput {
  readonly id: string;
  readonly text: string;
}

interface EffectTextRule {
  readonly triggerEvent: string;
  readonly opcode: EffectOpcode;
  readonly args: JsonObject;
  readonly target?: boolean;
}

const EFFECT_TEXT_RULES = new Map<string, EffectTextRule>([
  [
    "when this card arrives, draw 1 card",
    { triggerEvent: "card.arrives", opcode: "draw.cards", args: { count: 1 } }
  ],
  [
    "when this card is discarded, draw 1 card",
    { triggerEvent: "card.discarded", opcode: "draw.cards", args: { count: 1 } }
  ],
  [
    "when this card arrives, deal 2 damage to target",
    {
      triggerEvent: "card.arrives",
      opcode: "damage.target",
      args: { amount: 2 },
      target: true
    }
  ],
  [
    "when this card arrives, gain 1 energy",
    {
      triggerEvent: "card.arrives",
      opcode: "gain.energy",
      args: { amount: 1, player: "self" }
    }
  ],
  [
    "when this card arrives, summon this card",
    { triggerEvent: "card.arrives", opcode: "summon.self", args: {} }
  ]
]);

function normalizeEffectText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.]$/, "");
}

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

export function compileEffectText(
  input: EffectTextCompilationInput
): EffectTextCompilationResult {
  if (typeof input.id !== "string" || !ID_PATTERN.test(input.id)) {
    throw new EffectIrValidationError([
      { path: "$.id", code: "invalid-identifier", message: "Expected a stable card id." }
    ]);
  }
  if (typeof input.text !== "string") {
    throw new EffectIrValidationError([
      { path: "$.text", code: "invalid-text", message: "Expected card text as a string." }
    ]);
  }

  const normalized = normalizeEffectText(input.text);
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

  const rule = EFFECT_TEXT_RULES.get(normalized);
  if (rule === undefined) {
    return {
      status: "judgeRequired",
      ir: null,
      issues: [
        {
          path: `${input.id}.ability`,
          code: "judge-required",
          message: "The ability text is outside the explicitly verified compiler coverage."
        }
      ]
    };
  }

  const targetId = rule.target === true ? `${input.id}.target.selected` : undefined;
  const compiledArgs = { ...rule.args };
  const body: EffectIrNode[] = [];
  if (targetId !== undefined) {
    body.push({
      type: "target",
      id: targetId,
      placeholder: "selected-target",
      minCount: 1,
      maxCount: 1
    });
  }
  body.push({
    type: "trigger",
    id: `${input.id}.trigger`,
    event: rule.triggerEvent,
    body: [
      targetId === undefined
        ? {
            type: "effect",
            id: `${input.id}.effect`,
            opcode: rule.opcode,
            args: compiledArgs
          }
        : {
            type: "effect",
            id: `${input.id}.effect`,
            opcode: rule.opcode,
            args: compiledArgs,
            targetId
          }
    ]
  });

  const ir = {
    kind: "effect-ir",
    schemaVersion: EFFECT_IR_SCHEMA_VERSION,
    ruleset: SYNTHETIC_DEMO_RULESET,
    id: input.id,
    body
  };
  const result = validateEffectIr(ir);
  if (!result.ok) {
    throw new EffectIrValidationError(result.issues);
  }
  return { status: "executable", ir: result.value, issues: [] };
}

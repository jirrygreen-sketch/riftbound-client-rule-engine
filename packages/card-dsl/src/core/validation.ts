import {
  CARD_DSL_KIND,
  CARD_DSL_SCHEMA_VERSION,
  ID_PATTERN,
  SYMBOL_PATTERN,
  SYNTHETIC_DEMO_RULESET
} from "./constants.js";
import type {
  AutoResolveNode,
  CardDslDocument,
  CardDslNode,
  ChoiceNode,
  ChoiceOption,
  EffectNode,
  JsonObject,
  JsonValue,
  OptionalNode,
  TargetNode,
  TriggerNode,
  ValidationIssue,
  ValidationResult
} from "./types.js";

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

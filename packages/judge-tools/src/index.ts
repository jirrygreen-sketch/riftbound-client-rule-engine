export const JUDGE_TOOLS_SCHEMA_VERSION = 1 as const;
export const JUDGE_POLICY_KIND = "judge-policy-profile" as const;
export const JUDGE_REVIEW_REQUEST_KIND = "judge-review-request" as const;
export const JUDGE_DECISION_KIND = "judge-decision" as const;
export const SYNTHETIC_DEMO_RULESET_ID = "synthetic-demo" as const;
export const RULE_FIXTURE_SET_KIND = "rule-fixture-set" as const;
export const OFFICIAL_RADIANCE_RULESET_ID = "riftbound-core-1.5-radiance" as const;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];

export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export type JudgeSourceType =
  | "official-rule"
  | "official-case"
  | "policy-document";

/**
 * A source reference is metadata only. It intentionally has no field for
 * excerpting, quoting, or reproducing an official rule or case.
 */
export interface EvidenceRef {
  readonly sourceType: JudgeSourceType;
  readonly sourceId: string;
  readonly url: string;
  readonly version: string;
  readonly ref: string;
}

export type JudgeRequiredReasonCode =
  | "ambiguous-rule"
  | "conflicting-authorities"
  | "missing-authoritative-source"
  | "policy-escalation"
  | "discretionary-effect";

export interface JudgeRequiredReason {
  readonly code: JudgeRequiredReasonCode;
  readonly explanation: string;
  readonly evidence: readonly EvidenceRef[];
}

export type RuleCheckOutcome =
  | "pass"
  | "fail"
  | "indeterminate"
  | "conflict";

export interface JudgeRuleCheck {
  readonly checkId: string;
  readonly eventId: string;
  readonly outcome: RuleCheckOutcome;
  readonly evidence: readonly EvidenceRef[];
  readonly note: string;
}

export interface JudgeEvent {
  readonly id: string;
  readonly type: string;
  readonly sequence: number;
  /**
   * The only open-ended JSON region in this package. It carries the observed
   * event data without rewriting it as official rule or case text.
   */
  readonly payload: JsonObject;
}

export interface JudgeEscalationRule {
  readonly id: string;
  readonly eventType: string;
  readonly checkId: string;
  readonly outcomes: readonly RuleCheckOutcome[];
  readonly reasonCode: JudgeRequiredReasonCode;
}

export interface JudgePolicyProfile {
  readonly kind: typeof JUDGE_POLICY_KIND;
  readonly schemaVersion: typeof JUDGE_TOOLS_SCHEMA_VERSION;
  readonly id: string;
  readonly version: string;
  readonly rulesetId: string;
  readonly title: string;
  readonly summary: string;
  readonly sources: readonly EvidenceRef[];
  readonly requiredReasons: readonly JudgeRequiredReason[];
  readonly escalationRules: readonly JudgeEscalationRule[];
}

export interface JudgeProfileRef {
  readonly id: string;
  readonly version: string;
}

export interface JudgeReviewRequest {
  readonly kind: typeof JUDGE_REVIEW_REQUEST_KIND;
  readonly schemaVersion: typeof JUDGE_TOOLS_SCHEMA_VERSION;
  readonly requestId: string;
  readonly profile: JudgeProfileRef;
  readonly rulesetId: string;
  readonly event: JudgeEvent;
  readonly checks: readonly JudgeRuleCheck[];
  readonly reasons: readonly JudgeRequiredReason[];
  readonly evidence: readonly EvidenceRef[];
  readonly requestedAt: string;
  readonly status: "pending";
}

export type ReviewRequest = JudgeReviewRequest;

export type JudgeDecisionOutcome =
  | "allow"
  | "deny"
  | "modify"
  | "escalate";

export interface JudgeDecision {
  readonly kind: typeof JUDGE_DECISION_KIND;
  readonly schemaVersion: typeof JUDGE_TOOLS_SCHEMA_VERSION;
  readonly id: string;
  readonly requestId: string;
  readonly outcome: JudgeDecisionOutcome;
  readonly rationale: string;
  readonly evidence: readonly EvidenceRef[];
  readonly decidedBy: string;
  readonly decidedAt: string;
}

export type RuleFixtureDecision =
  | "auto"
  | "prompt"
  | "judgeRequired"
  | "notImplemented";

export type RuleFixtureCategory =
  | "source-governance"
  | "execute-as-much-as-possible"
  | "chain"
  | "priority"
  | "focus"
  | "cleanup"
  | "privacy"
  | "object-identity"
  | "judge-decision";

export type RuleSourceStatus = "published" | "historical";

/**
 * Publication and effectiveness metadata for a registered source. A future
 * effective date means the source is published but is not yet the active
 * authority for play.
 */
export interface RuleSourceLifecycle {
  readonly sourceId: string;
  readonly status: RuleSourceStatus;
  readonly publishedAt: string;
  readonly effectiveAt: string | null;
  readonly effectiveUntil: string | null;
  readonly sha256: string | null;
}

/**
 * A test-oriented assertion. `given` is the fixture precondition and `expected`
 * is the observable result required from a future engine implementation.
 */
export interface RuleFixtureAssertion {
  readonly id: string;
  readonly statement: string;
  readonly given: JsonObject;
  readonly expected: JsonObject;
  readonly evidence: readonly EvidenceRef[];
}

export interface RuleFixtureCase {
  readonly id: string;
  readonly category: RuleFixtureCategory;
  readonly decision: RuleFixtureDecision;
  readonly assertions: readonly RuleFixtureAssertion[];
  readonly judgeReason?: JudgeRequiredReason;
}

export interface RuleFixtureSet {
  readonly kind: typeof RULE_FIXTURE_SET_KIND;
  readonly schemaVersion: typeof JUDGE_TOOLS_SCHEMA_VERSION;
  readonly id: string;
  readonly rulesetId: string;
  readonly title: string;
  readonly summary: string;
  readonly asOf: string;
  readonly sources: readonly EvidenceRef[];
  readonly sourceLifecycles: readonly RuleSourceLifecycle[];
  readonly cases: readonly RuleFixtureCase[];
}

export interface JudgeValidationIssue {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

export type JudgeValidationResult<T> =
  | {
      readonly ok: true;
      readonly value: T;
      readonly issues: readonly [];
    }
  | {
      readonly ok: false;
      readonly issues: readonly JudgeValidationIssue[];
    };

export class JudgeValidationError extends Error {
  readonly issues: readonly JudgeValidationIssue[];

  constructor(issues: readonly JudgeValidationIssue[]) {
    super(formatIssues(issues));
    this.name = "JudgeValidationError";
    this.issues = issues;
  }
}

export interface CreateJudgeReviewRequestOptions {
  readonly requestedAt: string;
}

interface ValidationContext {
  readonly issues: JudgeValidationIssue[];
  readonly ancestors: WeakSet<object>;
}

const STABLE_ID_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const EVENT_TYPE_PATTERN = /^[a-z][a-z0-9]*(?:[.:-][a-z0-9]+)*$/;
const VERSION_PATTERN =
  /^(?:[0-9]+(?:\.[0-9]+){0,3}|[0-9]{4}-[0-9]{2}-[0-9]{2})(?:-[A-Za-z][0-9A-Za-z.-]*)?$/;
const REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const DECIDED_BY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const REQUEST_ID_PATTERN = /^judge-review-[0-9a-f]{16}$/;
const MAX_JSON_DEPTH = 64;
const MAX_EVIDENCE_REFS = 128;
const MAX_CHECKS = 64;
const MAX_REASONS = 32;
const MAX_ESCALATION_RULES = 64;
const MAX_SOURCES = 128;
const MAX_SOURCE_LIFECYCLES = 128;
const MAX_FIXTURE_CASES = 256;
const MAX_FIXTURE_ASSERTIONS = 64;
const UNSAFE_JSON_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const HIDDEN_HAND_KEYS = new Set([
  "hand",
  "hiddenhand",
  "privatehand",
  "concealedhand",
  "opponenthand"
]);

const SOURCE_TYPES = new Set<JudgeSourceType>([
  "official-rule",
  "official-case",
  "policy-document"
]);

const RULE_CHECK_OUTCOMES = new Set<RuleCheckOutcome>([
  "pass",
  "fail",
  "indeterminate",
  "conflict"
]);

const REQUIRED_REASON_CODES = new Set<JudgeRequiredReasonCode>([
  "ambiguous-rule",
  "conflicting-authorities",
  "missing-authoritative-source",
  "policy-escalation",
  "discretionary-effect"
]);

const DECISION_OUTCOMES = new Set<JudgeDecisionOutcome>([
  "allow",
  "deny",
  "modify",
  "escalate"
]);

const FIXTURE_DECISIONS = new Set<RuleFixtureDecision>([
  "auto",
  "prompt",
  "judgeRequired",
  "notImplemented"
]);

const FIXTURE_CATEGORIES = new Set<RuleFixtureCategory>([
  "source-governance",
  "execute-as-much-as-possible",
  "chain",
  "priority",
  "focus",
  "cleanup",
  "privacy",
  "object-identity",
  "judge-decision"
]);

function formatIssues(issues: readonly JudgeValidationIssue[]): string {
  return issues.map(issue => `${issue.path}: ${issue.message}`).join("\n");
}

function addIssue(
  context: ValidationContext,
  path: string,
  code: string,
  message: string
): void {
  context.issues.push({ path, code, message });
}

function newContext(): ValidationContext {
  return { issues: [], ancestors: new WeakSet() };
}

function runValidation<T>(
  input: unknown,
  reader: (value: unknown, context: ValidationContext) => T | null
): JudgeValidationResult<T> {
  const context = newContext();
  const value = reader(input, context);
  if (value === null || context.issues.length > 0) {
    return { ok: false, issues: context.issues };
  }
  return { ok: true, value, issues: [] };
}

function parseWith<T>(
  input: unknown,
  reader: (value: unknown, context: ValidationContext) => T | null
): T {
  const result = runValidation(input, reader);
  if (!result.ok) {
    throw new JudgeValidationError(result.issues);
  }
  return result.value;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOnlyAllowedKeys(
  value: Record<string, unknown>,
  path: string,
  required: readonly string[],
  optional: readonly string[],
  context: ValidationContext
): boolean {
  let valid = true;

  if (Object.getOwnPropertySymbols(value).length > 0) {
    addIssue(context, path, "symbol-key", "Symbol keys are not supported.");
    valid = false;
  }

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

  const allowed = new Set([...required, ...optional]);
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

function readExactRecord(
  value: unknown,
  path: string,
  required: readonly string[],
  optional: readonly string[],
  context: ValidationContext
): Record<string, unknown> | null {
  if (!isPlainRecord(value)) {
    addIssue(context, path, "invalid-object", "Expected a plain object.");
    return null;
  }

  return hasOnlyAllowedKeys(value, path, required, optional, context)
    ? value
    : null;
}

function readString(
  value: unknown,
  path: string,
  context: ValidationContext,
  options: {
    readonly pattern?: RegExp;
    readonly maxLength?: number;
    readonly description?: string;
    readonly allowWildcard?: boolean;
  } = {}
): string | null {
  const maxLength = options.maxLength ?? 240;
  const description = options.description ?? "a non-empty string";

  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > maxLength ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    addIssue(
      context,
      path,
      "invalid-string",
      `Expected ${description} with at most ${maxLength} characters.`
    );
    return null;
  }

  if (
    options.allowWildcard === true &&
    value === "*"
  ) {
    return value;
  }

  if (options.pattern && !options.pattern.test(value)) {
    addIssue(
      context,
      path,
      "invalid-identifier",
      `Expected ${description}.`
    );
    return null;
  }

  return value;
}

function readSafeInteger(
  value: unknown,
  path: string,
  context: ValidationContext,
  minimum: number
): number | null {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum
  ) {
    addIssue(
      context,
      path,
      "invalid-integer",
      `Expected a safe integer greater than or equal to ${minimum}.`
    );
    return null;
  }

  return value;
}

function readArray(
  value: unknown,
  path: string,
  context: ValidationContext,
  minimumLength: number,
  maximumLength: number
): readonly unknown[] | null {
  if (!Array.isArray(value)) {
    addIssue(context, path, "invalid-array", "Expected an array.");
    return null;
  }

  if (value.length < minimumLength || value.length > maximumLength) {
    addIssue(
      context,
      path,
      "invalid-array-length",
      `Expected between ${minimumLength} and ${maximumLength} items.`
    );
    return null;
  }

  return value;
}

function readJsonValue(
  value: unknown,
  path: string,
  context: ValidationContext,
  depth: number
): JsonValue | undefined {
  if (depth > MAX_JSON_DEPTH) {
    addIssue(context, path, "json-too-deep", `JSON data may not exceed ${MAX_JSON_DEPTH} levels.`);
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
    return Object.is(value, -0) ? 0 : value;
  }

  if (Array.isArray(value)) {
    if (context.ancestors.has(value)) {
      addIssue(context, path, "cyclic-value", "Cyclic values are not valid JSON.");
      return undefined;
    }

    context.ancestors.add(value);
    const result: JsonValue[] = [];
    value.forEach((item, index) => {
      const child = readJsonValue(item, `${path}[${index}]`, context, depth + 1);
      if (child !== undefined) {
        result.push(child);
      }
    });
    context.ancestors.delete(value);
    return result;
  }

  if (!isPlainRecord(value)) {
    addIssue(
      context,
      path,
      "non-json-value",
      "Expected a JSON primitive, array, or plain object."
    );
    return undefined;
  }

  if (context.ancestors.has(value)) {
    addIssue(context, path, "cyclic-value", "Cyclic values are not valid JSON.");
    return undefined;
  }

  context.ancestors.add(value);
  const result: Record<string, JsonValue> = {};
  for (const key of Object.keys(value)) {
    if (UNSAFE_JSON_KEYS.has(key)) {
      addIssue(
        context,
        `${path}.${key}`,
        "unsafe-json-key",
        `JSON object key "${key}" is not allowed.`
      );
      continue;
    }

    const normalizedKey = key.toLowerCase().replace(/[-_]/g, "");
    if (HIDDEN_HAND_KEYS.has(normalizedKey)) {
      addIssue(
        context,
        `${path}.${key}`,
        "private-hand-data",
        "Hidden hand data cannot be recorded."
      );
      continue;
    }

    const child = readJsonValue(value[key], `${path}.${key}`, context, depth + 1);
    if (child !== undefined) {
      result[key] = child;
    }
  }
  context.ancestors.delete(value);
  return result;
}

function readJsonObject(
  value: unknown,
  path: string,
  context: ValidationContext
): JsonObject | null {
  const normalized = readJsonValue(value, path, context, 0);
  if (normalized === undefined || normalized === null || Array.isArray(normalized)) {
    if (normalized !== undefined) {
      addIssue(context, path, "invalid-object", "Expected a JSON object.");
    }
    return null;
  }
  if (typeof normalized !== "object") {
    addIssue(context, path, "invalid-object", "Expected a JSON object.");
    return null;
  }
  return normalized as JsonObject;
}

function readSourceType(
  value: unknown,
  path: string,
  context: ValidationContext
): JudgeSourceType | null {
  if (typeof value !== "string" || !SOURCE_TYPES.has(value as JudgeSourceType)) {
    addIssue(
      context,
      path,
      "invalid-source-type",
      'Expected "official-rule", "official-case", or "policy-document".'
    );
    return null;
  }
  return value as JudgeSourceType;
}

function readVersion(
  value: unknown,
  path: string,
  context: ValidationContext
): string | null {
  return readString(value, path, context, {
    pattern: VERSION_PATTERN,
    maxLength: 64,
    description: "a numeric dotted or ISO date source version"
  });
}

function readRef(
  value: unknown,
  path: string,
  context: ValidationContext
): string | null {
  return readString(value, path, context, {
    pattern: REF_PATTERN,
    maxLength: 128,
    description: "a source-relative rule, section, or case reference"
  });
}

function readSourceUrl(
  value: unknown,
  path: string,
  context: ValidationContext
): string | null {
  if (typeof value !== "string" || value.length > 2048) {
    addIssue(context, path, "invalid-url", "Expected an HTTPS source URL.");
    return null;
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    addIssue(context, path, "invalid-url", "Expected an absolute HTTPS source URL.");
    return null;
  }

  const hasUnsupportedParts =
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    url.hostname === "localhost" ||
    !url.hostname.includes(".");

  if (hasUnsupportedParts) {
    addIssue(
      context,
      path,
      "invalid-url",
      "Source URLs must be public HTTPS URLs without credentials, a port, query, or fragment."
    );
    return null;
  }

  return url.href;
}

function readTimestamp(
  value: unknown,
  path: string,
  context: ValidationContext
): string | null {
  if (typeof value !== "string") {
    addIssue(context, path, "invalid-timestamp", "Expected a canonical UTC timestamp.");
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    addIssue(
      context,
      path,
      "invalid-timestamp",
      "Expected a canonical UTC timestamp such as 2026-10-11T00:00:00.000Z."
    );
    return null;
  }

  return value;
}

function readEvidenceRef(
  value: unknown,
  path: string,
  context: ValidationContext
): EvidenceRef | null {
  const record = readExactRecord(
    value,
    path,
    ["sourceType", "sourceId", "url", "version", "ref"],
    [],
    context
  );
  if (record === null) {
    return null;
  }

  const sourceType = readSourceType(record.sourceType, `${path}.sourceType`, context);
  const sourceId = readString(record.sourceId, `${path}.sourceId`, context, {
    pattern: STABLE_ID_PATTERN,
    maxLength: 128,
    description: "a stable source identifier"
  });
  const url = readSourceUrl(record.url, `${path}.url`, context);
  const version = readVersion(record.version, `${path}.version`, context);
  const ref = readRef(record.ref, `${path}.ref`, context);

  if (
    sourceType === null ||
    sourceId === null ||
    url === null ||
    version === null ||
    ref === null
  ) {
    return null;
  }

  return { sourceType, sourceId, url, version, ref };
}

function evidenceKey(evidence: EvidenceRef): string {
  return stableStringify(evidence as unknown as JsonValue);
}

function readEvidenceList(
  value: unknown,
  path: string,
  context: ValidationContext,
  minimumLength: number,
  maximumLength: number
): readonly EvidenceRef[] | null {
  const values = readArray(value, path, context, minimumLength, maximumLength);
  if (values === null) {
    return null;
  }

  const result: EvidenceRef[] = [];
  const seen = new Set<string>();
  values.forEach((item, index) => {
    const evidence = readEvidenceRef(item, `${path}[${index}]`, context);
    if (evidence === null) {
      return;
    }

    const key = evidenceKey(evidence);
    if (seen.has(key)) {
      addIssue(
        context,
        `${path}[${index}]`,
        "duplicate-evidence",
        "Evidence references must be unique within a list."
      );
      return;
    }
    seen.add(key);
    result.push(evidence);
  });

  return result;
}

function readReasonCode(
  value: unknown,
  path: string,
  context: ValidationContext
): JudgeRequiredReasonCode | null {
  if (typeof value !== "string" || !REQUIRED_REASON_CODES.has(value as JudgeRequiredReasonCode)) {
    addIssue(
      context,
      path,
      "invalid-reason-code",
      "Expected a supported judge-required reason code."
    );
    return null;
  }
  return value as JudgeRequiredReasonCode;
}

function readRuleCheckOutcome(
  value: unknown,
  path: string,
  context: ValidationContext
): RuleCheckOutcome | null {
  if (typeof value !== "string" || !RULE_CHECK_OUTCOMES.has(value as RuleCheckOutcome)) {
    addIssue(
      context,
      path,
      "invalid-outcome",
      'Expected "pass", "fail", "indeterminate", or "conflict".'
    );
    return null;
  }
  return value as RuleCheckOutcome;
}

function readDecisionOutcome(
  value: unknown,
  path: string,
  context: ValidationContext
): JudgeDecisionOutcome | null {
  if (typeof value !== "string" || !DECISION_OUTCOMES.has(value as JudgeDecisionOutcome)) {
    addIssue(
      context,
      path,
      "invalid-decision-outcome",
      'Expected "allow", "deny", "modify", or "escalate".'
    );
    return null;
  }
  return value as JudgeDecisionOutcome;
}

function readFixtureDecision(
  value: unknown,
  path: string,
  context: ValidationContext
): RuleFixtureDecision | null {
  if (
    typeof value !== "string" ||
    !FIXTURE_DECISIONS.has(value as RuleFixtureDecision)
  ) {
    addIssue(
      context,
      path,
      "invalid-fixture-decision",
      'Expected "auto", "prompt", "judgeRequired", or "notImplemented".'
    );
    return null;
  }
  return value as RuleFixtureDecision;
}

function readFixtureCategory(
  value: unknown,
  path: string,
  context: ValidationContext
): RuleFixtureCategory | null {
  if (
    typeof value !== "string" ||
    !FIXTURE_CATEGORIES.has(value as RuleFixtureCategory)
  ) {
    addIssue(
      context,
      path,
      "invalid-fixture-category",
      "Expected a supported rule fixture category."
    );
    return null;
  }
  return value as RuleFixtureCategory;
}

function readSourceStatus(
  value: unknown,
  path: string,
  context: ValidationContext
): RuleSourceStatus | null {
  if (typeof value !== "string" || (value !== "published" && value !== "historical")) {
    addIssue(
      context,
      path,
      "invalid-source-status",
      'Expected "published" or "historical".'
    );
    return null;
  }
  return value;
}

function readSha256(
  value: unknown,
  path: string,
  context: ValidationContext
): string | null {
  if (value === null) {
    return null;
  }
  return readString(value, path, context, {
    pattern: /^[0-9A-Fa-f]{64}$/,
    maxLength: 64,
    description: "a 64-character SHA-256 digest"
  })?.toUpperCase() ?? null;
}

function readSourceLifecycle(
  value: unknown,
  path: string,
  context: ValidationContext
): RuleSourceLifecycle | null {
  const record = readExactRecord(
    value,
    path,
    [
      "sourceId",
      "status",
      "publishedAt",
      "effectiveAt",
      "effectiveUntil",
      "sha256"
    ],
    [],
    context
  );
  if (record === null) {
    return null;
  }

  const sourceId = readString(record.sourceId, `${path}.sourceId`, context, {
    pattern: STABLE_ID_PATTERN,
    maxLength: 128,
    description: "a stable source identifier"
  });
  const status = readSourceStatus(record.status, `${path}.status`, context);
  const publishedAt = readTimestamp(record.publishedAt, `${path}.publishedAt`, context);
  const effectiveAtValue =
    record.effectiveAt === null ? null : readTimestamp(
      record.effectiveAt,
      `${path}.effectiveAt`,
      context
    );
  const effectiveUntilValue =
    record.effectiveUntil === null ? null : readTimestamp(
      record.effectiveUntil,
      `${path}.effectiveUntil`,
      context
    );
  const effectiveAt =
    record.effectiveAt === null || effectiveAtValue !== null
      ? effectiveAtValue
      : null;
  const effectiveUntil =
    record.effectiveUntil === null || effectiveUntilValue !== null
      ? effectiveUntilValue
      : null;
  const sha256 = readSha256(record.sha256, `${path}.sha256`, context) ?? null;

  if (
    sourceId === null ||
    status === null ||
    publishedAt === null
  ) {
    return null;
  }

  if (
    effectiveAt !== null &&
    effectiveUntil !== null &&
    effectiveUntil <= effectiveAt
  ) {
    addIssue(
      context,
      `${path}.effectiveUntil`,
      "invalid-effective-window",
      "effectiveUntil must be later than effectiveAt."
    );
    return null;
  }

  return { sourceId, status, publishedAt, effectiveAt, effectiveUntil, sha256 };
}

function readRequiredReason(
  value: unknown,
  path: string,
  context: ValidationContext
): JudgeRequiredReason | null {
  const record = readExactRecord(
    value,
    path,
    ["code", "explanation", "evidence"],
    [],
    context
  );
  if (record === null) {
    return null;
  }

  const code = readReasonCode(record.code, `${path}.code`, context);
  const explanation = readString(record.explanation, `${path}.explanation`, context, {
    maxLength: 320,
    description: "an original explanation"
  });
  const evidence = readEvidenceList(
    record.evidence,
    `${path}.evidence`,
    context,
    1,
    MAX_EVIDENCE_REFS
  );

  if (code === null || explanation === null || evidence === null) {
    return null;
  }
  return { code, explanation, evidence };
}

function readOutcomeList(
  value: unknown,
  path: string,
  context: ValidationContext
): readonly RuleCheckOutcome[] | null {
  const values = readArray(value, path, context, 1, RULE_CHECK_OUTCOMES.size);
  if (values === null) {
    return null;
  }

  const outcomes: RuleCheckOutcome[] = [];
  const seen = new Set<RuleCheckOutcome>();
  values.forEach((item, index) => {
    const outcome = readRuleCheckOutcome(item, `${path}[${index}]`, context);
    if (outcome === null) {
      return;
    }
    if (seen.has(outcome)) {
      addIssue(
        context,
        `${path}[${index}]`,
        "duplicate-outcome",
        `Outcome "${outcome}" is already listed.`
      );
      return;
    }
    seen.add(outcome);
    outcomes.push(outcome);
  });
  return outcomes;
}

function readEscalationRule(
  value: unknown,
  path: string,
  context: ValidationContext
): JudgeEscalationRule | null {
  const record = readExactRecord(
    value,
    path,
    ["id", "eventType", "checkId", "outcomes", "reasonCode"],
    [],
    context
  );
  if (record === null) {
    return null;
  }

  const id = readString(record.id, `${path}.id`, context, {
    pattern: STABLE_ID_PATTERN,
    maxLength: 128,
    description: "a stable escalation-rule identifier"
  });
  const eventType = readString(record.eventType, `${path}.eventType`, context, {
    pattern: EVENT_TYPE_PATTERN,
    maxLength: 128,
    description: "an event type or the * wildcard",
    allowWildcard: true
  });
  const checkId = readString(record.checkId, `${path}.checkId`, context, {
    pattern: STABLE_ID_PATTERN,
    maxLength: 128,
    description: "a rule-check identifier or the * wildcard",
    allowWildcard: true
  });
  const outcomes = readOutcomeList(record.outcomes, `${path}.outcomes`, context);
  const reasonCode = readReasonCode(record.reasonCode, `${path}.reasonCode`, context);

  if (
    id === null ||
    eventType === null ||
    checkId === null ||
    outcomes === null ||
    reasonCode === null
  ) {
    return null;
  }
  return { id, eventType, checkId, outcomes, reasonCode };
}

function readPolicyProfile(
  value: unknown,
  context: ValidationContext
): JudgePolicyProfile | null {
  const record = readExactRecord(
    value,
    "$",
    [
      "kind",
      "schemaVersion",
      "id",
      "version",
      "rulesetId",
      "title",
      "summary",
      "sources",
      "requiredReasons",
      "escalationRules"
    ],
    [],
    context
  );
  if (record === null) {
    return null;
  }

  if (record.kind !== JUDGE_POLICY_KIND) {
    addIssue(context, "$.kind", "invalid-kind", `Expected "${JUDGE_POLICY_KIND}".`);
  }
  if (record.schemaVersion !== JUDGE_TOOLS_SCHEMA_VERSION) {
    addIssue(
      context,
      "$.schemaVersion",
      "unsupported-schema-version",
      `Expected schema version ${JUDGE_TOOLS_SCHEMA_VERSION}.`
    );
  }

  const id = readString(record.id, "$.id", context, {
    pattern: STABLE_ID_PATTERN,
    maxLength: 128,
    description: "a stable policy identifier"
  });
  const version = readVersion(record.version, "$.version", context);
  const rulesetId = readString(record.rulesetId, "$.rulesetId", context, {
    pattern: STABLE_ID_PATTERN,
    maxLength: 128,
    description: "a stable ruleset identifier"
  });
  const title = readString(record.title, "$.title", context, {
    maxLength: 160,
    description: "an original policy title"
  });
  const summary = readString(record.summary, "$.summary", context, {
    maxLength: 600,
    description: "an original policy summary"
  });
  const sources = readEvidenceList(
    record.sources,
    "$.sources",
    context,
    1,
    MAX_SOURCES
  );

  const reasonValues = readArray(
    record.requiredReasons,
    "$.requiredReasons",
    context,
    1,
    MAX_REASONS
  );
  const requiredReasons: JudgeRequiredReason[] = [];
  const reasonCodes = new Set<JudgeRequiredReasonCode>();
  if (reasonValues !== null) {
    reasonValues.forEach((item, index) => {
      const reason = readRequiredReason(
        item,
        `$.requiredReasons[${index}]`,
        context
      );
      if (reason === null) {
        return;
      }
      if (reasonCodes.has(reason.code)) {
        addIssue(
          context,
          `$.requiredReasons[${index}].code`,
          "duplicate-reason-code",
          `Reason code "${reason.code}" is already defined.`
        );
        return;
      }
      reasonCodes.add(reason.code);
      requiredReasons.push(reason);
    });
  }

  const ruleValues = readArray(
    record.escalationRules,
    "$.escalationRules",
    context,
    1,
    MAX_ESCALATION_RULES
  );
  const escalationRules: JudgeEscalationRule[] = [];
  const escalationRuleIds = new Set<string>();
  if (ruleValues !== null) {
    ruleValues.forEach((item, index) => {
      const rule = readEscalationRule(
        item,
        `$.escalationRules[${index}]`,
        context
      );
      if (rule === null) {
        return;
      }
      if (escalationRuleIds.has(rule.id)) {
        addIssue(
          context,
          `$.escalationRules[${index}].id`,
          "duplicate-escalation-rule",
          `Escalation rule "${rule.id}" is already defined.`
        );
        return;
      }
      escalationRuleIds.add(rule.id);
      escalationRules.push(rule);
    });
  }

  if (sources !== null && requiredReasons.length > 0) {
    const sourceKeys = new Set(sources.map(evidenceKey));
    requiredReasons.forEach((reason, reasonIndex) => {
      reason.evidence.forEach((evidence, evidenceIndex) => {
        if (!sourceKeys.has(evidenceKey(evidence))) {
          addIssue(
            context,
            `$.requiredReasons[${reasonIndex}].evidence[${evidenceIndex}]`,
            "unregistered-evidence",
            "Reason evidence must also appear in profile.sources."
          );
        }
      });
    });
  }

  escalationRules.forEach((rule, index) => {
    if (!reasonCodes.has(rule.reasonCode)) {
      addIssue(
        context,
        `$.escalationRules[${index}].reasonCode`,
        "unknown-reason-code",
        `Escalation rule "${rule.id}" references an undefined reason code.`
      );
    }
  });

  if (
    typeof record.kind !== "string" ||
    record.schemaVersion !== JUDGE_TOOLS_SCHEMA_VERSION ||
    id === null ||
    version === null ||
    rulesetId === null ||
    title === null ||
    summary === null ||
    sources === null ||
    reasonValues === null ||
    ruleValues === null
  ) {
    return null;
  }

  return {
    kind: JUDGE_POLICY_KIND,
    schemaVersion: JUDGE_TOOLS_SCHEMA_VERSION,
    id,
    version,
    rulesetId,
    title,
    summary,
    sources,
    requiredReasons,
    escalationRules
  };
}

function readJudgeEvent(
  value: unknown,
  path: string,
  context: ValidationContext
): JudgeEvent | null {
  const record = readExactRecord(
    value,
    path,
    ["id", "type", "sequence", "payload"],
    [],
    context
  );
  if (record === null) {
    return null;
  }

  const id = readString(record.id, `${path}.id`, context, {
    pattern: STABLE_ID_PATTERN,
    maxLength: 128,
    description: "a stable event identifier"
  });
  const type = readString(record.type, `${path}.type`, context, {
    pattern: EVENT_TYPE_PATTERN,
    maxLength: 128,
    description: "a stable event type"
  });
  const sequence = readSafeInteger(record.sequence, `${path}.sequence`, context, 1);
  const payload = readJsonObject(record.payload, `${path}.payload`, context);

  if (id === null || type === null || sequence === null || payload === null) {
    return null;
  }
  return { id, type, sequence, payload };
}

function readJudgeRuleCheck(
  value: unknown,
  path: string,
  context: ValidationContext
): JudgeRuleCheck | null {
  const record = readExactRecord(
    value,
    path,
    ["checkId", "eventId", "outcome", "evidence", "note"],
    [],
    context
  );
  if (record === null) {
    return null;
  }

  const checkId = readString(record.checkId, `${path}.checkId`, context, {
    pattern: STABLE_ID_PATTERN,
    maxLength: 128,
    description: "a stable rule-check identifier"
  });
  const eventId = readString(record.eventId, `${path}.eventId`, context, {
    pattern: STABLE_ID_PATTERN,
    maxLength: 128,
    description: "a stable event identifier"
  });
  const outcome = readRuleCheckOutcome(record.outcome, `${path}.outcome`, context);
  const evidence = readEvidenceList(
    record.evidence,
    `${path}.evidence`,
    context,
    1,
    MAX_EVIDENCE_REFS
  );
  const note = readString(record.note, `${path}.note`, context, {
    maxLength: 320,
    description: "an original rule-check note"
  });

  if (
    checkId === null ||
    eventId === null ||
    outcome === null ||
    evidence === null ||
    note === null
  ) {
    return null;
  }
  return { checkId, eventId, outcome, evidence, note };
}

function readProfileRef(
  value: unknown,
  path: string,
  context: ValidationContext
): JudgeProfileRef | null {
  const record = readExactRecord(value, path, ["id", "version"], [], context);
  if (record === null) {
    return null;
  }
  const id = readString(record.id, `${path}.id`, context, {
    pattern: STABLE_ID_PATTERN,
    maxLength: 128,
    description: "a stable policy identifier"
  });
  const version = readVersion(record.version, `${path}.version`, context);
  if (id === null || version === null) {
    return null;
  }
  return { id, version };
}

function readReasonList(
  value: unknown,
  path: string,
  context: ValidationContext
): readonly JudgeRequiredReason[] | null {
  const values = readArray(value, path, context, 1, MAX_REASONS);
  if (values === null) {
    return null;
  }

  const reasons: JudgeRequiredReason[] = [];
  const seen = new Set<JudgeRequiredReasonCode>();
  values.forEach((item, index) => {
    const reason = readRequiredReason(item, `${path}[${index}]`, context);
    if (reason === null) {
      return;
    }
    if (seen.has(reason.code)) {
      addIssue(
        context,
        `${path}[${index}].code`,
        "duplicate-reason-code",
        `Reason code "${reason.code}" is already present.`
      );
      return;
    }
    seen.add(reason.code);
    reasons.push(reason);
  });
  return reasons;
}

function readRuleCheckList(
  value: unknown,
  path: string,
  context: ValidationContext
): readonly JudgeRuleCheck[] | null {
  const values = readArray(value, path, context, 1, MAX_CHECKS);
  if (values === null) {
    return null;
  }

  const checks: JudgeRuleCheck[] = [];
  const seen = new Set<string>();
  values.forEach((item, index) => {
    const check = readJudgeRuleCheck(item, `${path}[${index}]`, context);
    if (check === null) {
      return;
    }
    if (seen.has(check.checkId)) {
      addIssue(
        context,
        `${path}[${index}].checkId`,
        "duplicate-check-id",
        `Rule-check id "${check.checkId}" is already present.`
      );
      return;
    }
    seen.add(check.checkId);
    checks.push(check);
  });
  return checks;
}

function collectEvidence(
  checks: readonly JudgeRuleCheck[],
  reasons: readonly JudgeRequiredReason[]
): readonly EvidenceRef[] {
  const evidence: EvidenceRef[] = [];
  const seen = new Set<string>();
  for (const check of checks) {
    for (const item of check.evidence) {
      const key = evidenceKey(item);
      if (!seen.has(key)) {
        seen.add(key);
        evidence.push(item);
      }
    }
  }
  for (const reason of reasons) {
    for (const item of reason.evidence) {
      const key = evidenceKey(item);
      if (!seen.has(key)) {
        seen.add(key);
        evidence.push(item);
      }
    }
  }
  return evidence;
}

function isSameEvidenceList(
  left: readonly EvidenceRef[],
  right: readonly EvidenceRef[]
): boolean {
  return left.length === right.length &&
    left.every((item, index) => evidenceKey(item) === evidenceKey(right[index]!));
}

function readReviewRequestCore(
  value: unknown,
  context: ValidationContext
): Omit<JudgeReviewRequest, "requestId"> | null {
  const record = readExactRecord(
    value,
    "$",
    [
      "kind",
      "schemaVersion",
      "profile",
      "rulesetId",
      "event",
      "checks",
      "reasons",
      "evidence",
      "requestedAt",
      "status"
    ],
    [],
    context
  );
  if (record === null) {
    return null;
  }

  if (record.kind !== JUDGE_REVIEW_REQUEST_KIND) {
    addIssue(
      context,
      "$.kind",
      "invalid-kind",
      `Expected "${JUDGE_REVIEW_REQUEST_KIND}".`
    );
  }
  if (record.schemaVersion !== JUDGE_TOOLS_SCHEMA_VERSION) {
    addIssue(
      context,
      "$.schemaVersion",
      "unsupported-schema-version",
      `Expected schema version ${JUDGE_TOOLS_SCHEMA_VERSION}.`
    );
  }

  const profile = readProfileRef(record.profile, "$.profile", context);
  const rulesetId = readString(record.rulesetId, "$.rulesetId", context, {
    pattern: STABLE_ID_PATTERN,
    maxLength: 128,
    description: "a stable ruleset identifier"
  });
  const event = readJudgeEvent(record.event, "$.event", context);
  const checks = readRuleCheckList(record.checks, "$.checks", context);
  const reasons = readReasonList(record.reasons, "$.reasons", context);
  const evidence = readEvidenceList(
    record.evidence,
    "$.evidence",
    context,
    1,
    MAX_EVIDENCE_REFS
  );
  const requestedAt = readTimestamp(record.requestedAt, "$.requestedAt", context);

  if (record.status !== "pending") {
    addIssue(context, "$.status", "invalid-status", 'Expected "pending".');
  }

  if (event !== null && checks !== null) {
    checks.forEach((check, index) => {
      if (check.eventId !== event.id) {
        addIssue(
          context,
          `$.checks[${index}].eventId`,
          "event-id-mismatch",
          `Expected the event id "${event.id}".`
        );
      }
    });
  }

  if (checks !== null && reasons !== null && evidence !== null) {
    const derivedEvidence = collectEvidence(checks, reasons);
    if (!isSameEvidenceList(derivedEvidence, evidence)) {
      addIssue(
        context,
        "$.evidence",
        "derived-evidence-mismatch",
        "Evidence must be the unique ordered union of check and reason evidence."
      );
    }
  }

  if (
    typeof record.kind !== "string" ||
    record.schemaVersion !== JUDGE_TOOLS_SCHEMA_VERSION ||
    profile === null ||
    rulesetId === null ||
    event === null ||
    checks === null ||
    reasons === null ||
    evidence === null ||
    requestedAt === null ||
    record.status !== "pending"
  ) {
    return null;
  }

  return {
    kind: JUDGE_REVIEW_REQUEST_KIND,
    schemaVersion: JUDGE_TOOLS_SCHEMA_VERSION,
    profile,
    rulesetId,
    event,
    checks,
    reasons,
    evidence,
    requestedAt,
    status: "pending"
  };
}

function readReviewRequest(
  value: unknown,
  context: ValidationContext
): JudgeReviewRequest | null {
  const record = readExactRecord(
    value,
    "$",
    [
      "kind",
      "schemaVersion",
      "requestId",
      "profile",
      "rulesetId",
      "event",
      "checks",
      "reasons",
      "evidence",
      "requestedAt",
      "status"
    ],
    [],
    context
  );
  if (record === null) {
    return null;
  }

  const { requestId: _requestId, ...coreInput } = record;
  const requestId = readString(record.requestId, "$.requestId", context, {
    pattern: REQUEST_ID_PATTERN,
    maxLength: 32,
    description: "a stable review-request identifier"
  });
  const core = readReviewRequestCore(coreInput, context);
  if (requestId === null || core === null) {
    return null;
  }

  const expectedRequestId = createReviewRequestId(core);
  if (requestId !== expectedRequestId) {
    addIssue(
      context,
      "$.requestId",
      "request-id-mismatch",
      `Expected the request id "${expectedRequestId}".`
    );
    return null;
  }

  return { ...core, requestId };
}

function readJudgeDecision(
  value: unknown,
  context: ValidationContext
): JudgeDecision | null {
  const record = readExactRecord(
    value,
    "$",
    [
      "kind",
      "schemaVersion",
      "id",
      "requestId",
      "outcome",
      "rationale",
      "evidence",
      "decidedBy",
      "decidedAt"
    ],
    [],
    context
  );
  if (record === null) {
    return null;
  }

  if (record.kind !== JUDGE_DECISION_KIND) {
    addIssue(context, "$.kind", "invalid-kind", `Expected "${JUDGE_DECISION_KIND}".`);
  }
  if (record.schemaVersion !== JUDGE_TOOLS_SCHEMA_VERSION) {
    addIssue(
      context,
      "$.schemaVersion",
      "unsupported-schema-version",
      `Expected schema version ${JUDGE_TOOLS_SCHEMA_VERSION}.`
    );
  }

  const id = readString(record.id, "$.id", context, {
    pattern: STABLE_ID_PATTERN,
    maxLength: 128,
    description: "a stable decision identifier"
  });
  const requestId = readString(record.requestId, "$.requestId", context, {
    pattern: REQUEST_ID_PATTERN,
    maxLength: 32,
    description: "a stable review-request identifier"
  });
  const outcome = readDecisionOutcome(record.outcome, "$.outcome", context);
  const rationale = readString(record.rationale, "$.rationale", context, {
    maxLength: 600,
    description: "an original decision rationale"
  });
  const evidence = readEvidenceList(
    record.evidence,
    "$.evidence",
    context,
    1,
    MAX_EVIDENCE_REFS
  );
  const decidedBy = readString(record.decidedBy, "$.decidedBy", context, {
    pattern: DECIDED_BY_PATTERN,
    maxLength: 128,
    description: "a stable judge identifier"
  });
  const decidedAt = readTimestamp(record.decidedAt, "$.decidedAt", context);

  if (
    typeof record.kind !== "string" ||
    record.schemaVersion !== JUDGE_TOOLS_SCHEMA_VERSION ||
    id === null ||
    requestId === null ||
    outcome === null ||
    rationale === null ||
    evidence === null ||
    decidedBy === null ||
    decidedAt === null
  ) {
    return null;
  }

  return {
    kind: JUDGE_DECISION_KIND,
    schemaVersion: JUDGE_TOOLS_SCHEMA_VERSION,
    id,
    requestId,
    outcome,
    rationale,
    evidence,
    decidedBy,
    decidedAt
  };
}

function readFixtureAssertion(
  value: unknown,
  path: string,
  context: ValidationContext
): RuleFixtureAssertion | null {
  const record = readExactRecord(
    value,
    path,
    ["id", "statement", "given", "expected", "evidence"],
    [],
    context
  );
  if (record === null) {
    return null;
  }

  const id = readString(record.id, `${path}.id`, context, {
    pattern: STABLE_ID_PATTERN,
    maxLength: 128,
    description: "a stable assertion identifier"
  });
  const statement = readString(record.statement, `${path}.statement`, context, {
    maxLength: 320,
    description: "an original assertion statement"
  });
  const given = readJsonObject(record.given, `${path}.given`, context);
  const expected = readJsonObject(record.expected, `${path}.expected`, context);
  const evidence = readEvidenceList(
    record.evidence,
    `${path}.evidence`,
    context,
    1,
    MAX_EVIDENCE_REFS
  );

  if (
    id === null ||
    statement === null ||
    given === null ||
    expected === null ||
    evidence === null
  ) {
    return null;
  }

  return { id, statement, given, expected, evidence };
}

function readFixtureCase(
  value: unknown,
  path: string,
  context: ValidationContext
): RuleFixtureCase | null {
  const record = readExactRecord(
    value,
    path,
    ["id", "category", "decision", "assertions"],
    ["judgeReason"],
    context
  );
  if (record === null) {
    return null;
  }

  const id = readString(record.id, `${path}.id`, context, {
    pattern: STABLE_ID_PATTERN,
    maxLength: 128,
    description: "a stable fixture identifier"
  });
  const category = readFixtureCategory(record.category, `${path}.category`, context);
  const decision = readFixtureDecision(record.decision, `${path}.decision`, context);

  const assertionValues = readArray(
    record.assertions,
    `${path}.assertions`,
    context,
    1,
    MAX_FIXTURE_ASSERTIONS
  );
  const assertions: RuleFixtureAssertion[] = [];
  const assertionIds = new Set<string>();
  if (assertionValues !== null) {
    assertionValues.forEach((item, index) => {
      const assertion = readFixtureAssertion(
        item,
        `${path}.assertions[${index}]`,
        context
      );
      if (assertion === null) {
        return;
      }
      if (assertionIds.has(assertion.id)) {
        addIssue(
          context,
          `${path}.assertions[${index}].id`,
          "duplicate-assertion-id",
          `Assertion id "${assertion.id}" is already present.`
        );
        return;
      }
      assertionIds.add(assertion.id);
      assertions.push(assertion);
    });
  }

  const judgeReason =
    record.judgeReason === undefined
      ? undefined
      : readRequiredReason(record.judgeReason, `${path}.judgeReason`, context) ??
        undefined;

  if (
    id === null ||
    category === null ||
    decision === null ||
    assertionValues === null
  ) {
    return null;
  }

  if (decision === "judgeRequired" && judgeReason === undefined) {
    addIssue(
      context,
      `${path}.judgeReason`,
      "missing-judge-reason",
      'A "judgeRequired" fixture must explain the escalation and cite evidence.'
    );
  }
  if (decision !== "judgeRequired" && judgeReason !== undefined) {
    addIssue(
      context,
      `${path}.judgeReason`,
      "unexpected-judge-reason",
      "Only a \"judgeRequired\" fixture may define judgeReason."
    );
  }

  return {
    id,
    category,
    decision,
    assertions,
    ...(judgeReason === undefined ? {} : { judgeReason })
  };
}

function readRuleFixtureSet(
  value: unknown,
  context: ValidationContext
): RuleFixtureSet | null {
  const record = readExactRecord(
    value,
    "$",
    [
      "kind",
      "schemaVersion",
      "id",
      "rulesetId",
      "title",
      "summary",
      "asOf",
      "sources",
      "sourceLifecycles",
      "cases"
    ],
    [],
    context
  );
  if (record === null) {
    return null;
  }

  if (record.kind !== RULE_FIXTURE_SET_KIND) {
    addIssue(
      context,
      "$.kind",
      "invalid-kind",
      `Expected "${RULE_FIXTURE_SET_KIND}".`
    );
  }
  if (record.schemaVersion !== JUDGE_TOOLS_SCHEMA_VERSION) {
    addIssue(
      context,
      "$.schemaVersion",
      "unsupported-schema-version",
      `Expected schema version ${JUDGE_TOOLS_SCHEMA_VERSION}.`
    );
  }

  const id = readString(record.id, "$.id", context, {
    pattern: STABLE_ID_PATTERN,
    maxLength: 128,
    description: "a stable fixture-set identifier"
  });
  const rulesetId = readString(record.rulesetId, "$.rulesetId", context, {
    pattern: STABLE_ID_PATTERN,
    maxLength: 128,
    description: "a stable ruleset identifier"
  });
  const title = readString(record.title, "$.title", context, {
    maxLength: 160,
    description: "an original fixture-set title"
  });
  const summary = readString(record.summary, "$.summary", context, {
    maxLength: 600,
    description: "an original fixture-set summary"
  });
  const asOf = readTimestamp(record.asOf, "$.asOf", context);
  const sources = readEvidenceList(record.sources, "$.sources", context, 1, MAX_SOURCES);

  const lifecycleValues = readArray(
    record.sourceLifecycles,
    "$.sourceLifecycles",
    context,
    1,
    MAX_SOURCE_LIFECYCLES
  );
  const sourceLifecycles: RuleSourceLifecycle[] = [];
  const lifecycleIds = new Set<string>();
  if (lifecycleValues !== null) {
    lifecycleValues.forEach((item, index) => {
      const lifecycle = readSourceLifecycle(
        item,
        `$.sourceLifecycles[${index}]`,
        context
      );
      if (lifecycle === null) {
        return;
      }
      if (lifecycleIds.has(lifecycle.sourceId)) {
        addIssue(
          context,
          `$.sourceLifecycles[${index}].sourceId`,
          "duplicate-source-lifecycle",
          `Source lifecycle "${lifecycle.sourceId}" is already present.`
        );
        return;
      }
      lifecycleIds.add(lifecycle.sourceId);
      sourceLifecycles.push(lifecycle);
    });
  }

  const caseValues = readArray(
    record.cases,
    "$.cases",
    context,
    1,
    MAX_FIXTURE_CASES
  );
  const cases: RuleFixtureCase[] = [];
  const caseIds = new Set<string>();
  if (caseValues !== null) {
    caseValues.forEach((item, index) => {
      const fixtureCase = readFixtureCase(item, `$.cases[${index}]`, context);
      if (fixtureCase === null) {
        return;
      }
      if (caseIds.has(fixtureCase.id)) {
        addIssue(
          context,
          `$.cases[${index}].id`,
          "duplicate-fixture-id",
          `Fixture id "${fixtureCase.id}" is already present.`
        );
        return;
      }
      caseIds.add(fixtureCase.id);
      cases.push(fixtureCase);
    });
  }

  if (sources !== null) {
    const sourceIds = new Set(sources.map(source => source.sourceId));
    sourceLifecycles.forEach((lifecycle, index) => {
      if (!sourceIds.has(lifecycle.sourceId)) {
        addIssue(
          context,
          `$.sourceLifecycles[${index}].sourceId`,
          "unknown-source-lifecycle",
          "Source lifecycle references a source that is not registered."
        );
      }
    });
    sources.forEach((source, index) => {
      if (!lifecycleIds.has(source.sourceId)) {
        addIssue(
          context,
          `$.sources[${index}].sourceId`,
          "missing-source-lifecycle",
          "Every registered source must have lifecycle metadata."
        );
      }
    });
  }

  if (asOf !== null && sourceLifecycles.length > 0) {
    sourceLifecycles.forEach((lifecycle, index) => {
      if (lifecycle.publishedAt > asOf) {
        addIssue(
          context,
          `$.sourceLifecycles[${index}].publishedAt`,
          "future-publication",
          "A source cannot be published after the fixture set's asOf timestamp."
        );
      }
      if (
        lifecycle.effectiveAt !== null &&
        lifecycle.effectiveAt < lifecycle.publishedAt
      ) {
        addIssue(
          context,
          `$.sourceLifecycles[${index}].effectiveAt`,
          "invalid-effective-date",
          "effectiveAt must be on or after publishedAt."
        );
      }
      if (lifecycle.status === "historical" && lifecycle.effectiveUntil === null) {
        addIssue(
          context,
          `$.sourceLifecycles[${index}].effectiveUntil`,
          "missing-effective-until",
          "A historical source must record effectiveUntil."
        );
      }
    });
  }

  if (sources !== null && cases.length > 0) {
    const sourceKeys = new Set(sources.map(evidenceKey));
    cases.forEach((fixtureCase, caseIndex) => {
      fixtureCase.assertions.forEach((assertion, assertionIndex) => {
        assertion.evidence.forEach((evidence, evidenceIndex) => {
          if (!sourceKeys.has(evidenceKey(evidence))) {
            addIssue(
              context,
              `$.cases[${caseIndex}].assertions[${assertionIndex}].evidence[${evidenceIndex}]`,
              "unregistered-evidence",
              "Assertion evidence must also appear in the fixture set sources."
            );
          }
        });
      });
      if (fixtureCase.judgeReason !== undefined) {
        fixtureCase.judgeReason.evidence.forEach((evidence, evidenceIndex) => {
          if (!sourceKeys.has(evidenceKey(evidence))) {
            addIssue(
              context,
              `$.cases[${caseIndex}].judgeReason.evidence[${evidenceIndex}]`,
              "unregistered-evidence",
              "Judge-reason evidence must also appear in the fixture set sources."
            );
          }
        });
      }
    });
  }

  if (
    typeof record.kind !== "string" ||
    record.schemaVersion !== JUDGE_TOOLS_SCHEMA_VERSION ||
    id === null ||
    rulesetId === null ||
    title === null ||
    summary === null ||
    asOf === null ||
    sources === null ||
    lifecycleValues === null ||
    caseValues === null
  ) {
    return null;
  }

  return {
    kind: RULE_FIXTURE_SET_KIND,
    schemaVersion: JUDGE_TOOLS_SCHEMA_VERSION,
    id,
    rulesetId,
    title,
    summary,
    asOf,
    sources,
    sourceLifecycles,
    cases
  };
}

function stableStringify(value: JsonValue): string {
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return JSON.stringify(value);
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  const objectValue = value as JsonObject;
  const entries = Object.keys(objectValue)
    .sort()
    .map(key => `${JSON.stringify(key)}:${stableStringify(objectValue[key]!)}`);
  return `{${entries.join(",")}}`;
}

function stableHash(value: JsonValue): string {
  const bytes = new TextEncoder().encode(stableStringify(value));
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;

  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * prime);
  }

  return hash.toString(16).padStart(16, "0");
}

function createReviewRequestId(
  request: Omit<JudgeReviewRequest, "requestId">
): string {
  return `judge-review-${stableHash(request as unknown as JsonValue)}`;
}

function ruleMatches(
  rule: JudgeEscalationRule,
  event: JudgeEvent,
  checks: readonly JudgeRuleCheck[]
): boolean {
  if (rule.eventType !== "*" && rule.eventType !== event.type) {
    return false;
  }

  return checks.some(check =>
    (rule.checkId === "*" || rule.checkId === check.checkId) &&
    rule.outcomes.includes(check.outcome)
  );
}

export function validateEvidenceRef(input: unknown): JudgeValidationResult<EvidenceRef> {
  return runValidation(input, (value, context) => readEvidenceRef(value, "$", context));
}

export function parseEvidenceRef(input: unknown): EvidenceRef {
  return parseWith(input, (value, context) => readEvidenceRef(value, "$", context));
}

export function validateJudgePolicyProfile(
  input: unknown
): JudgeValidationResult<JudgePolicyProfile> {
  return runValidation(input, readPolicyProfile);
}

export function parseJudgePolicyProfile(input: unknown): JudgePolicyProfile {
  return parseWith(input, readPolicyProfile);
}

export function validateJudgeEvent(input: unknown): JudgeValidationResult<JudgeEvent> {
  return runValidation(input, (value, context) => readJudgeEvent(value, "$", context));
}

export function parseJudgeEvent(input: unknown): JudgeEvent {
  return parseWith(input, (value, context) => readJudgeEvent(value, "$", context));
}

export function validateJudgeRuleCheck(
  input: unknown
): JudgeValidationResult<JudgeRuleCheck> {
  return runValidation(input, (value, context) => readJudgeRuleCheck(value, "$", context));
}

export function parseJudgeRuleCheck(input: unknown): JudgeRuleCheck {
  return parseWith(input, (value, context) => readJudgeRuleCheck(value, "$", context));
}

export function validateJudgeRuleChecks(
  input: unknown
): JudgeValidationResult<readonly JudgeRuleCheck[]> {
  return runValidation(input, (value, context) => readRuleCheckList(value, "$", context));
}

export function parseJudgeRuleChecks(input: unknown): readonly JudgeRuleCheck[] {
  return parseWith(input, (value, context) => readRuleCheckList(value, "$", context));
}

export function validateJudgeReviewRequest(
  input: unknown
): JudgeValidationResult<JudgeReviewRequest> {
  return runValidation(input, readReviewRequest);
}

export function parseJudgeReviewRequest(input: unknown): JudgeReviewRequest {
  return parseWith(input, readReviewRequest);
}

export function validateJudgeDecision(
  input: unknown
): JudgeValidationResult<JudgeDecision> {
  return runValidation(input, readJudgeDecision);
}

export function parseJudgeDecision(input: unknown): JudgeDecision {
  return parseWith(input, readJudgeDecision);
}

export function validateRuleFixtureSet(input: unknown): JudgeValidationResult<RuleFixtureSet> {
  return runValidation(input, readRuleFixtureSet);
}

export function parseRuleFixtureSet(input: unknown): RuleFixtureSet {
  return parseWith(input, readRuleFixtureSet);
}

export function createJudgeReviewRequest(
  profileInput: unknown,
  eventInput: unknown,
  checksInput: unknown,
  optionsInput: unknown
): JudgeReviewRequest | null {
  const profile = parseJudgePolicyProfile(profileInput);
  const event = parseJudgeEvent(eventInput);
  const checks = parseJudgeRuleChecks(checksInput);
  const optionsContext = newContext();
  const options = readExactRecord(
    optionsInput,
    "$.options",
    ["requestedAt"],
    [],
    optionsContext
  );
  if (options === null) {
    throw new JudgeValidationError(optionsContext.issues);
  }
  const requestedAt = readTimestamp(
    options.requestedAt,
    "$.options.requestedAt",
    optionsContext
  );
  if (requestedAt === null) {
    throw new JudgeValidationError(optionsContext.issues);
  }

  const checkContext = newContext();
  const sourceKeys = new Set(profile.sources.map(evidenceKey));
  checks.forEach((check, checkIndex) => {
    if (check.eventId !== event.id) {
      addIssue(
        checkContext,
        `$.checks[${checkIndex}].eventId`,
        "event-id-mismatch",
        `Expected the event id "${event.id}".`
      );
    }
    check.evidence.forEach((evidence, evidenceIndex) => {
      if (!sourceKeys.has(evidenceKey(evidence))) {
        addIssue(
          checkContext,
          `$.checks[${checkIndex}].evidence[${evidenceIndex}]`,
          "unregistered-evidence",
          "Rule-check evidence must also appear in profile.sources."
        );
      }
    });
  });
  if (checkContext.issues.length > 0) {
    throw new JudgeValidationError(checkContext.issues);
  }

  const reasonByCode = new Map(
    profile.requiredReasons.map(reason => [reason.code, reason] as const)
  );
  const matchedReasons: JudgeRequiredReason[] = [];
  const matchedCodes = new Set<JudgeRequiredReasonCode>();
  for (const rule of profile.escalationRules) {
    if (!ruleMatches(rule, event, checks) || matchedCodes.has(rule.reasonCode)) {
      continue;
    }
    const reason = reasonByCode.get(rule.reasonCode);
    if (reason === undefined) {
      throw new JudgeValidationError([
        {
          path: "$.profile.escalationRules",
          code: "unknown-reason-code",
          message: `Escalation rule "${rule.id}" references an undefined reason code.`
        }
      ]);
    }
    matchedCodes.add(rule.reasonCode);
    matchedReasons.push(reason);
  }

  if (matchedReasons.length === 0) {
    return null;
  }

  const core: Omit<JudgeReviewRequest, "requestId"> = {
    kind: JUDGE_REVIEW_REQUEST_KIND,
    schemaVersion: JUDGE_TOOLS_SCHEMA_VERSION,
    profile: { id: profile.id, version: profile.version },
    rulesetId: profile.rulesetId,
    event,
    checks,
    reasons: matchedReasons,
    evidence: collectEvidence(checks, matchedReasons),
    requestedAt,
    status: "pending"
  };

  return {
    ...core,
    requestId: createReviewRequestId(core)
  };
}

export function createSyntheticDemoJudgePolicyProfile(): JudgePolicyProfile {
  const source: EvidenceRef = {
    sourceType: "policy-document",
    sourceId: "synthetic-demo.judge-policy",
    url: "https://example.com/riftbound/synthetic-demo/judge-policy",
    version: "1.0.0",
    ref: "section/escalation"
  };

  return parseJudgePolicyProfile({
    kind: JUDGE_POLICY_KIND,
    schemaVersion: JUDGE_TOOLS_SCHEMA_VERSION,
    id: "judge.synthetic-demo",
    version: "1.0.0",
    rulesetId: SYNTHETIC_DEMO_RULESET_ID,
    title: "Synthetic demo judge policy",
    summary:
      "Original demo metadata for escalating indeterminate or conflicting synthetic-demo rule checks.",
    sources: [source],
    requiredReasons: [
      {
        code: "ambiguous-rule",
        explanation:
          "The synthetic check cannot select a deterministic result from the available policy metadata.",
        evidence: [source]
      },
      {
        code: "conflicting-authorities",
        explanation:
          "Two or more synthetic rule checks produced results that require a human determination.",
        evidence: [source]
      }
    ],
    escalationRules: [
      {
        id: "demo.escalate.zone-owner",
        eventType: "demo.zone-entered",
        checkId: "demo.check.zone-owner",
        outcomes: ["indeterminate"],
        reasonCode: "ambiguous-rule"
      },
      {
        id: "demo.escalate.conflict",
        eventType: "demo.zone-entered",
        checkId: "*",
        outcomes: ["conflict"],
        reasonCode: "conflicting-authorities"
      }
    ]
  });
}

export function createOfficialRadianceRuleFixtureSet(): RuleFixtureSet {
  const coreRules: EvidenceRef = {
    sourceType: "official-rule",
    sourceId: "riftbound.core-rules",
    url: "https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf",
    version: "1.5",
    ref: "55"
  };
  const coreRulesAt = (ref: string): EvidenceRef => ({ ...coreRules, ref });
  const officialFaq: EvidenceRef = {
    sourceType: "official-case",
    sourceId: "riftbound.official-faq",
    url: "https://playriftbound.com/en-us/news/rules-and-releases/vendetta-rules-faq-and-clarifications",
    version: "2026-08-14",
    ref: "article"
  };
  const radiancePatchNotes: EvidenceRef = {
    sourceType: "official-rule",
    sourceId: "riftbound.radiance-patch-notes",
    url: "https://playriftbound.com/en-us/news/announcements/core-rules-radiance-patch-notes-effective-october-16-2026/",
    version: "2026-10-09",
    ref: "article"
  };
  const tournamentRules: EvidenceRef = {
    sourceType: "policy-document",
    sourceId: "riftbound.tournament-rules",
    url: "https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/861752822d217edf37d9febaeaf77a7d924c1bb6.pdf",
    version: "2026-10-09",
    ref: "article"
  };

  return parseRuleFixtureSet({
    kind: RULE_FIXTURE_SET_KIND,
    schemaVersion: JUDGE_TOOLS_SCHEMA_VERSION,
    id: "official.core-1.5-radiance.2026-10-11",
    rulesetId: OFFICIAL_RADIANCE_RULESET_ID,
    title: "Official Core Rules 1.5 Radiance fixtures",
    summary:
      "Traceable assertions for the published Radiance Core Rules. The fixture records its as-of date and the separate Radiance effective date.",
    asOf: "2026-10-11T00:00:00.000Z",
    sources: [
      coreRulesAt("55"),
      coreRulesAt("55.1"),
      coreRulesAt("107.3.f"),
      coreRulesAt("108.7.c"),
      coreRulesAt("108.7.e"),
      coreRulesAt("124"),
      coreRulesAt("124.1"),
      coreRulesAt("128.2.a"),
      coreRulesAt("128.3"),
      coreRulesAt("128.4"),
      coreRulesAt("128.5"),
      coreRulesAt("128.6"),
      coreRulesAt("128.6.a"),
      coreRulesAt("311"),
      coreRulesAt("312"),
      coreRulesAt("312.2"),
      coreRulesAt("313"),
      coreRulesAt("313.1"),
      coreRulesAt("313.2"),
      coreRulesAt("313.3"),
      coreRulesAt("313.4"),
      coreRulesAt("313.5"),
      coreRulesAt("312.1"),
      coreRulesAt("319"),
      coreRulesAt("320"),
      coreRulesAt("320.1"),
      coreRulesAt("321"),
      coreRulesAt("321.1"),
      coreRulesAt("322"),
      coreRulesAt("322.1"),
      coreRulesAt("333"),
      coreRulesAt("334"),
      coreRulesAt("334.2.a"),
      coreRulesAt("336.1"),
      coreRulesAt("337"),
      coreRulesAt("337.1"),
      coreRulesAt("337.1.a"),
      coreRulesAt("337.1.b"),
      coreRulesAt("337.2"),
      coreRulesAt("340.1"),
      coreRulesAt("341"),
      coreRulesAt("344"),
      coreRulesAt("345"),
      coreRulesAt("346"),
      coreRulesAt("346.1"),
      coreRulesAt("347"),
      coreRulesAt("348"),
      officialFaq,
      radiancePatchNotes,
      tournamentRules
    ],
    sourceLifecycles: [
      {
        sourceId: coreRules.sourceId,
        status: "published",
        publishedAt: "2026-10-09T00:00:00.000Z",
        effectiveAt: "2026-10-16T00:00:00.000Z",
        effectiveUntil: null,
        sha256: "94D41FEE86F88B61C4157C0389C0595D990B98E5B42555C99D9F649EE64D1FEC"
      },
      {
        sourceId: officialFaq.sourceId,
        status: "published",
        publishedAt: "2026-08-14T01:00:00.000Z",
        effectiveAt: "2026-08-14T01:00:00.000Z",
        effectiveUntil: "2026-10-16T00:00:00.000Z",
        sha256: null
      },
      {
        sourceId: radiancePatchNotes.sourceId,
        status: "published",
        publishedAt: "2026-10-09T16:00:00.000Z",
        effectiveAt: "2026-10-16T00:00:00.000Z",
        effectiveUntil: null,
        sha256: null
      },
      {
        sourceId: tournamentRules.sourceId,
        status: "published",
        publishedAt: "2026-10-09T16:00:00.000Z",
        effectiveAt: "2026-10-16T00:00:00.000Z",
        effectiveUntil: null,
        sha256: "CE07DA4FB632526AFBBCE7F058287A57E7444FA6BDE17B0938FF52CE3FAB3D07"
      }
    ],
    cases: [
      {
        id: "source.governance.radiance-effective-window",
        category: "source-governance",
        decision: "auto",
        assertions: [
          {
            id: "source.governance.radiance-effective-window.assert-1",
            statement:
              "A match envelope must not activate the Radiance ruleset before 2026-10-16 even though its sources were published on 2026-10-09.",
            given: {
              checkedAt: "2026-10-11T00:00:00.000Z",
              rulesetVersion: "1.5",
              sourcePublishedAt: "2026-10-09T00:00:00.000Z"
            },
            expected: {
              active: false,
              reason: "published-before-effective-date"
            },
            evidence: [radiancePatchNotes, tournamentRules]
          }
        ]
      },
      {
        id: "chain.finalize.order",
        category: "chain",
        decision: "auto",
        assertions: [
          {
            id: "chain.finalize.order.assert-1",
            statement:
              "Pending Chain Items finalize in the order they were appended and finalization does not pass Priority.",
            given: {
              pendingChainItemIds: ["chain-item-1", "chain-item-2"]
            },
            expected: {
              finalizedOrder: ["chain-item-1", "chain-item-2"],
              priorityPassedOnFinalize: false
            },
            evidence: [coreRulesAt("337.1"), coreRulesAt("337.1.a"), coreRulesAt("337.1.b")]
          },
          {
            id: "chain.finalize.immediate-resolution.exception",
            statement:
              "After finalization, a Unit, Gear, or resource-adding ability resolves immediately rather than waiting for the general newest-first resolution order.",
            given: {
              finalizedItemType: "unit"
            },
            expected: {
              movesToResolveImmediately: true,
              resolutionMode: "finalization-exception"
            },
            evidence: [coreRulesAt("337.2")]
          }
        ]
      },
      {
        id: "chain.resolve.newest-finalized-first",
        category: "chain",
        decision: "auto",
        assertions: [
          {
            id: "chain.resolve.newest-finalized-first.assert-1",
            statement: "The newest finalized Chain Item resolves first.",
            given: {
              finalizedChainItemIds: ["chain-item-1", "chain-item-2"]
            },
            expected: { firstResolvedChainItemId: "chain-item-2" },
            evidence: [coreRulesAt("340.1")]
          }
        ]
      },
      {
        id: "priority.focus.single-holder",
        category: "priority",
        decision: "auto",
        assertions: [
          {
            id: "priority.focus.single-holder.assert-1",
            statement:
              "At most one player holds Priority and at most one player holds Focus.",
            given: { candidatePlayerIds: ["player-1", "player-2"] },
            expected: {
              maxPriorityHolders: 1,
              maxFocusHolders: 1
            },
            evidence: [coreRulesAt("312"), coreRulesAt("313")]
          }
        ]
      },
      {
        id: "focus.priority-coupling",
        category: "focus",
        decision: "auto",
        assertions: [
          {
            id: "focus.priority-coupling.assert-1",
            statement:
              "Gaining Focus also grants Priority; Focus without Priority cannot authorize discretionary actions.",
            given: { focusHolder: "player-1", priorityHolder: null },
            expected: {
              discretionaryActionAllowed: false
            },
            evidence: [
              coreRulesAt("313.2"),
              coreRulesAt("313.4"),
              coreRulesAt("312.1")
            ]
          }
        ]
      },
      {
        id: "focus.showdown-does-not-pass-after-triggered-or-add-chain",
        category: "focus",
        decision: "auto",
        assertions: [
          {
            id: "focus.showdown-does-not-pass-after-triggered-or-add-chain.assert-1",
            statement:
              "After a Showdown chain opened by a triggered ability or Add ability fully resolves, Focus does not pass merely because the turn returns to Open State.",
            given: {
              showdownOpenState: true,
              chainOpener: "triggered-ability"
            },
            expected: { focusPasses: false },
            evidence: [coreRulesAt("346.1")]
          }
        ]
      },
      {
        id: "cleanup.blocks-fepr-priority-focus",
        category: "cleanup",
        decision: "auto",
        assertions: [
          {
            id: "cleanup.blocks-fepr-priority-focus.assert-1",
            statement:
              "While Cleanup occurs, finalized Chain Items cannot resolve, and Priority or Focus cannot be passed or awarded.",
            given: { cleanupInProgress: true },
            expected: {
              resolveFinalizedItems: false,
              passOrAwardPriority: false,
              passOrAwardFocus: false
            },
            evidence: [coreRulesAt("320"), coreRulesAt("320.1")]
          }
        ]
      },
      {
        id: "cleanup.recursive-fixed-point",
        category: "cleanup",
        decision: "auto",
        assertions: [
          {
            id: "cleanup.recursive-fixed-point.assert-1",
            statement:
              "A state change during Cleanup schedules another Cleanup immediately, repeating until a Cleanup produces no new state change.",
            given: {
              cleanupGeneratesStateChanges: [true, true, false]
            },
            expected: {
              cleanupExecutionCount: 3,
              finalCleanupChangedState: false
            },
            evidence: [coreRulesAt("322"), coreRulesAt("322.1")]
          }
        ]
      },
      {
        id: "cleanup.deferred-during-resolution",
        category: "cleanup",
        decision: "auto",
        assertions: [
          {
            id: "cleanup.deferred-during-resolution.assert-1",
            statement:
              "A qualifying state change during Chain Item resolution schedules an Outstanding Task instead of running Cleanup immediately.",
            given: {
              chainItemResolving: true,
              eventQualifiesForCleanup: true
            },
            expected: {
              cleanupRunsImmediately: false,
              cleanupBecomesOutstandingTask: true
            },
            evidence: [coreRulesAt("321"), coreRulesAt("321.1")]
          }
        ]
      },
      {
        id: "execute.partially-impossible",
        category: "execute-as-much-as-possible",
        decision: "notImplemented",
        assertions: [
          {
            id: "execute.partially-impossible.assert-1",
            statement:
              "The engine must execute possible instructions and ignore impossible instructions while resolving card text.",
            given: {
              instructions: [
                { id: "possible-1", possible: true },
                { id: "impossible-1", possible: false }
              ]
            },
            expected: {
              executedInstructionIds: ["possible-1"],
              ignoredInstructionIds: ["impossible-1"]
            },
            evidence: [coreRulesAt("55")]
          },
          {
            id: "execute.fully-impossible.assert-1",
            statement:
              "A card with only impossible instructions still plays and resolves, with no effect.",
            given: { allInstructionsImpossible: true },
            expected: {
              played: true,
              resolved: true,
              effectsExecuted: []
            },
            evidence: [coreRulesAt("55.1")]
          }
        ]
      },
      {
        id: "privacy.hand-count-public",
        category: "privacy",
        decision: "auto",
        assertions: [
          {
            id: "privacy.hand-count-public.assert-1",
            statement:
              "Hand cards are private, while the number of cards in a hand remains public.",
            given: { zone: "hand", handCardCount: 5 },
            expected: {
              visibleToOwnerOnlyCardFaces: true,
              publicHandCount: 5
            },
            evidence: [
              coreRulesAt("108.7.c"),
              coreRulesAt("108.7.e"),
              coreRulesAt("128.4")
            ]
          }
        ]
      },
      {
        id: "privacy.facedown-zone-public-card-private",
        category: "privacy",
        decision: "auto",
        assertions: [
          {
            id: "privacy.facedown-zone-public-card-private.assert-1",
            statement:
              "A Facedown Zone is public, but a facedown card located there is private.",
            given: { zoneType: "facedown", cardOrientation: "facedown" },
            expected: {
              zonePrivacy: "public",
              cardPrivacy: "private"
            },
            evidence: [coreRulesAt("107.3.f"), coreRulesAt("128.4")]
          }
        ]
      },
      {
        id: "privacy.cannot-compel-typed-secret-choice",
        category: "privacy",
        decision: "prompt",
        assertions: [
          {
            id: "privacy.cannot-compel-typed-secret-choice.assert-1",
            statement:
              "A player may decline an otherwise compelled action on secret or private cards when the action specifies a card type or quality; the ignored instruction is treated as impossible.",
            given: {
              instructionRequiresCardType: true,
              eligibleCardsArePrivate: true
            },
            expected: {
              allowedToDecline: true,
              ignoredInstructionTreatedAs: "impossible"
            },
            evidence: [coreRulesAt("128.6"), coreRulesAt("128.6.a")]
          }
        ]
      },
      {
        id: "object.identity.non-board-boundary",
        category: "object-identity",
        decision: "notImplemented",
        assertions: [
          {
            id: "object.identity.non-board-boundary.assert-1",
            statement:
              "A Game Object that crosses to or from a Non-Board Zone becomes a new object for tracking purposes.",
            given: {
              fromZoneClass: "board",
              toZoneClass: "non-board",
              initialGameObjectId: "object-1"
            },
            expected: {
              createsNewGameObjectId: true,
              preservesOldGameObjectId: false
            },
            evidence: [coreRulesAt("124")]
          },
          {
            id: "object.identity.non-board-boundary.assert-2",
            statement:
              "Crossing a Non-Board boundary also clears tracked temporary modifications such as damage, counters, granted keywords, and statuses.",
            given: {
              crossingNonBoardBoundary: true,
              temporaryModifications: ["damage", "counter", "granted-keyword", "status"]
            },
            expected: {
              retainedTemporaryModifications: []
            },
            evidence: [coreRulesAt("124.1")]
          }
        ]
      },
      {
        id: "judge.required-unknown-card-semantics",
        category: "judge-decision",
        decision: "judgeRequired",
        assertions: [
          {
            id: "judge.required-unknown-card-semantics.assert-1",
            statement:
              "Card text without a supported executable semantic must block automatic resolution and escalate to a judge instead of approximating behavior.",
            given: {
              cardTextSemantic: "unsupported",
              automaticResolutionCandidate: true
            },
            expected: {
              autoResolve: false,
              blockGameFlow: true,
              escalation: "judgeRequired"
            },
            evidence: [officialFaq, coreRulesAt("55")]
          }
        ],
        judgeReason: {
          code: "missing-authoritative-source",
          explanation:
            "No registered official source defines a complete executable semantic for this exact card text and game context.",
          evidence: [officialFaq, coreRulesAt("55")]
        }
      },
      {
        id: "judge.tournament-policy-separate-layer",
        category: "judge-decision",
        decision: "judgeRequired",
        assertions: [
          {
            id: "judge.tournament-policy-separate-layer.assert-1",
            statement:
              "Missed triggers, rewind, and slow-play outcomes are tournament policy decisions and must not be inferred by the Core Rules engine as defaults.",
            given: {
              scenario: "tournament-policy-only",
              coreRulesAnswerAvailable: false
            },
            expected: {
              engineAppliesCoreRules: true,
              engineAppliesTournamentPolicyDefault: false,
              escalation: "judgeRequired"
            },
            evidence: [tournamentRules, coreRulesAt("333")]
          }
        ],
        judgeReason: {
          code: "policy-escalation",
          explanation:
            "The outcome depends on the active tournament policy and the specific facts observed by the judge.",
          evidence: [tournamentRules]
        }
      }
    ]
  });
}

export function serializeEvidenceRef(input: unknown): string {
  return stableStringify(parseEvidenceRef(input) as unknown as JsonValue);
}

export function serializeJudgePolicyProfile(input: unknown): string {
  return stableStringify(parseJudgePolicyProfile(input) as unknown as JsonValue);
}

export function stableHashJudgePolicyProfile(input: unknown): string {
  return `fnv1a64:${stableHash(
    parseJudgePolicyProfile(input) as unknown as JsonValue
  )}`;
}

export function serializeJudgeReviewRequest(input: unknown): string {
  return stableStringify(parseJudgeReviewRequest(input) as unknown as JsonValue);
}

export function stableHashJudgeReviewRequest(input: unknown): string {
  return `fnv1a64:${stableHash(
    parseJudgeReviewRequest(input) as unknown as JsonValue
  )}`;
}

export function serializeJudgeDecision(input: unknown): string {
  return stableStringify(parseJudgeDecision(input) as unknown as JsonValue);
}

export function stableHashJudgeDecision(input: unknown): string {
  return `fnv1a64:${stableHash(
    parseJudgeDecision(input) as unknown as JsonValue
  )}`;
}

export function serializeRuleFixtureSet(input: unknown): string {
  return stableStringify(parseRuleFixtureSet(input) as unknown as JsonValue);
}

export function stableHashRuleFixtureSet(input: unknown): string {
  return `fnv1a64:${stableHash(
    parseRuleFixtureSet(input) as unknown as JsonValue
  )}`;
}

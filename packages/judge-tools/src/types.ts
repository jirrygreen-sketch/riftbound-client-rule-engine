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

export interface CreateJudgeReviewRequestOptions {
  readonly requestedAt: string;
}

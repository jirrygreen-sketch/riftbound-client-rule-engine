import {
  JUDGE_POLICY_KIND,
  JUDGE_REVIEW_REQUEST_KIND,
  JUDGE_TOOLS_SCHEMA_VERSION,
  SYNTHETIC_DEMO_RULESET_ID
} from "./types.js";
import type {
  EvidenceRef,
  JudgeEvent,
  JudgePolicyProfile,
  JudgeRequiredReason,
  JudgeRequiredReasonCode,
  JudgeReviewRequest,
  JudgeRuleCheck
} from "./types.js";
import { createReviewRequestId } from "./stable.js";
import {
  addIssue,
  collectEvidence,
  evidenceKey,
  JudgeValidationError,
  newContext,
  parseJudgeEvent,
  parseJudgePolicyProfile,
  parseJudgeRuleChecks,
  readExactRecord,
  readTimestamp,
  ruleMatches
} from "./validation.js";
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

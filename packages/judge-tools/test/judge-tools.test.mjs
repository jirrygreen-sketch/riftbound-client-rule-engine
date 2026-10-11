import assert from "node:assert/strict";
import test from "node:test";
import {
  JudgeValidationError,
  createJudgeReviewRequest,
  createSyntheticDemoJudgePolicyProfile,
  parseJudgeDecision,
  parseJudgeReviewRequest,
  serializeJudgeDecision,
  serializeJudgeReviewRequest,
  stableHashJudgeReviewRequest,
  validateEvidenceRef,
  validateJudgePolicyProfile,
  validateJudgeReviewRequest
} from "../dist/index.js";

const REQUESTED_AT = "2026-10-11T00:00:00.000Z";

function source(overrides = {}) {
  return {
    sourceType: "policy-document",
    sourceId: "synthetic-demo.judge-policy",
    url: "https://example.com/riftbound/synthetic-demo/judge-policy",
    version: "1.0.0",
    ref: "section/escalation",
    ...overrides
  };
}

function event(overrides = {}) {
  return {
    id: "demo.event.1",
    type: "demo.zone-entered",
    sequence: 1,
    payload: {
      controller: "player.one",
      zone: "demo.arena"
    },
    ...overrides
  };
}

function check(overrides = {}) {
  return {
    checkId: "demo.check.zone-owner",
    eventId: "demo.event.1",
    outcome: "indeterminate",
    evidence: [source()],
    note: "The original synthetic check could not choose an owner.",
    ...overrides
  };
}

function decision(requestId, overrides = {}) {
  return {
    kind: "judge-decision",
    schemaVersion: 1,
    id: "demo.decision.1",
    requestId,
    outcome: "allow",
    rationale: "The synthetic event matches the demo policy.",
    evidence: [source()],
    decidedBy: "judge.demo",
    decidedAt: REQUESTED_AT,
    ...overrides
  };
}

test("accepts the synthetic-demo policy and serializes it stably", () => {
  const profile = createSyntheticDemoJudgePolicyProfile();
  const result = validateJudgePolicyProfile(profile);

  assert.equal(result.ok, true);
  assert.equal(profile.rulesetId, "synthetic-demo");
  assert.equal(profile.requiredReasons.length, 2);
  assert.equal(profile.escalationRules.length, 2);
});

test("rejects unknown fields instead of allowing copied case content", () => {
  const policyWithText = {
    ...createSyntheticDemoJudgePolicyProfile(),
    officialCaseText: "not allowed"
  };
  const policyResult = validateJudgePolicyProfile(policyWithText);
  assert.equal(policyResult.ok, false);
  assert.ok(policyResult.issues.some(issue => issue.code === "unknown-field"));

  const evidenceResult = validateEvidenceRef({
    ...source(),
    excerpt: "not allowed"
  });
  assert.equal(evidenceResult.ok, false);
  assert.ok(evidenceResult.issues.some(issue => issue.code === "unknown-field"));
});

test("strictly validates source URL, version, and ref metadata", () => {
  const invalidUrls = [
    "http://example.com/policy",
    "https://user:pass@example.com/policy",
    "https://example.com/policy?version=1",
    "https://example.com/policy#section"
  ];

  for (const url of invalidUrls) {
    const result = validateEvidenceRef(source({ url }));
    assert.equal(result.ok, false, url);
    assert.ok(result.issues.some(issue => issue.code === "invalid-url"), url);
  }

  const invalidVersion = validateEvidenceRef(source({ version: "latest" }));
  assert.equal(invalidVersion.ok, false);
  assert.ok(invalidVersion.issues.some(issue => issue.code === "invalid-identifier"));

  const invalidRef = validateEvidenceRef(source({ ref: "section with spaces" }));
  assert.equal(invalidRef.ok, false);
  assert.ok(invalidRef.issues.some(issue => issue.code === "invalid-identifier"));
});

test("creates a pending manual review request from an indeterminate check", () => {
  const profile = createSyntheticDemoJudgePolicyProfile();
  const request = createJudgeReviewRequest(
    profile,
    event(),
    [check()],
    { requestedAt: REQUESTED_AT }
  );

  assert.notEqual(request, null);
  assert.equal(request.status, "pending");
  assert.match(request.requestId, /^judge-review-[0-9a-f]{16}$/);
  assert.deepEqual(
    request.reasons.map(reason => reason.code),
    ["ambiguous-rule"]
  );
  assert.equal(request.evidence.length, 1);
  assert.equal(parseJudgeReviewRequest(request).requestId, request.requestId);
  assert.equal(validateJudgeReviewRequest(request).ok, true);
});

test("maps conflicting checks and deduplicates evidence in stable order", () => {
  const profile = createSyntheticDemoJudgePolicyProfile();
  const request = createJudgeReviewRequest(
    profile,
    event(),
    [
      check({
        checkId: "demo.check.first",
        outcome: "conflict",
        evidence: [source()]
      }),
      check({
        checkId: "demo.check.second",
        outcome: "conflict",
        evidence: [source()]
      })
    ],
    { requestedAt: REQUESTED_AT }
  );

  assert.notEqual(request, null);
  assert.deepEqual(
    request.reasons.map(reason => reason.code),
    ["conflicting-authorities"]
  );
  assert.deepEqual(
    request.evidence.map(evidence => evidence.ref),
    ["section/escalation"]
  );
});

test("returns null when the profile has no matching escalation rule", () => {
  const request = createJudgeReviewRequest(
    createSyntheticDemoJudgePolicyProfile(),
    event(),
    [check({ outcome: "pass" })],
    { requestedAt: REQUESTED_AT }
  );

  assert.equal(request, null);
});

test("rejects unregistered evidence and mismatched event ids", () => {
  assert.throws(
    () =>
      createJudgeReviewRequest(
        createSyntheticDemoJudgePolicyProfile(),
        event(),
        [check({ evidence: [source({ ref: "section/unregistered" })] })],
        { requestedAt: REQUESTED_AT }
      ),
    error =>
      error instanceof JudgeValidationError &&
      error.issues.some(issue => issue.code === "unregistered-evidence")
  );

  assert.throws(
    () =>
      createJudgeReviewRequest(
        createSyntheticDemoJudgePolicyProfile(),
        event(),
        [check({ eventId: "demo.event.other" })],
        { requestedAt: REQUESTED_AT }
      ),
    error =>
      error instanceof JudgeValidationError &&
      error.issues.some(issue => issue.code === "event-id-mismatch")
  );
});

test("request IDs and serialization do not depend on object key order", () => {
  const first = createJudgeReviewRequest(
    createSyntheticDemoJudgePolicyProfile(),
    event(),
    [check()],
    { requestedAt: REQUESTED_AT }
  );
  const second = createJudgeReviewRequest(
    createSyntheticDemoJudgePolicyProfile(),
    {
      payload: { zone: "demo.arena", controller: "player.one" },
      sequence: 1,
      type: "demo.zone-entered",
      id: "demo.event.1"
    },
    [
      {
        note: "The original synthetic check could not choose an owner.",
        evidence: [source()],
        outcome: "indeterminate",
        eventId: "demo.event.1",
        checkId: "demo.check.zone-owner"
      }
    ],
    { requestedAt: REQUESTED_AT }
  );

  assert.notEqual(first, null);
  assert.notEqual(second, null);
  assert.equal(first.requestId, second.requestId);
  assert.equal(serializeJudgeReviewRequest(first), serializeJudgeReviewRequest(second));
  assert.equal(stableHashJudgeReviewRequest(first), stableHashJudgeReviewRequest(second));
});

test("validates and serializes an original judge decision", () => {
  const request = createJudgeReviewRequest(
    createSyntheticDemoJudgePolicyProfile(),
    event(),
    [check()],
    { requestedAt: REQUESTED_AT }
  );
  assert.notEqual(request, null);

  const record = decision(request.requestId);
  const parsed = parseJudgeDecision(record);
  assert.equal(parsed.outcome, "allow");
  assert.equal(
    serializeJudgeDecision(record),
    serializeJudgeDecision({ ...record, evidence: [source()] })
  );

  const invalid = { ...record, rationale: undefined };
  assert.throws(() => parseJudgeDecision(invalid));
});

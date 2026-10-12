import assert from "node:assert/strict";
import test from "node:test";
import {
  JudgeValidationError,
  createJudgeReviewRequest,
  createOfficialRadianceRuleFixtureSet,
  createSyntheticDemoJudgePolicyProfile,
  parseJudgeDecision,
  parseJudgeReviewRequest,
  parseRuleFixtureSet,
  serializeEvidenceRef,
  serializeJudgeDecision,
  serializeJudgeReviewRequest,
  stableHashRuleFixtureSet,
  serializeRuleFixtureSet,
  stableHashJudgeReviewRequest,
  validateEvidenceRef,
  validateJudgePolicyProfile,
  validateJudgeReviewRequest,
  validateJudgeEvent,
  validateRuleFixtureSet
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

  const isoDateVersion = validateEvidenceRef(source({ version: "2026-10-09" }));
  assert.equal(isoDateVersion.ok, true);
  assert.equal(isoDateVersion.value.version, "2026-10-09");

  const malformedDateVersion = validateEvidenceRef(source({ version: "2026-10" }));
  assert.equal(malformedDateVersion.ok, false);
  assert.ok(malformedDateVersion.issues.some(issue => issue.code === "invalid-identifier"));
});

test("requires judge events to use positive replay sequence numbers", () => {
  const result = validateJudgeReviewRequest({
    kind: "judge-review-request",
    schemaVersion: 1,
    requestId: "judge-review-0000000000000000",
    profile: { id: "judge.synthetic-demo", version: "1.0.0" },
    rulesetId: "synthetic-demo",
    event: event({ sequence: 0 }),
    checks: [check()],
    reasons: [
      {
        code: "ambiguous-rule",
        explanation: "The synthetic check cannot select a deterministic result.",
        evidence: [source()]
      }
    ],
    evidence: [source()],
    requestedAt: REQUESTED_AT,
    status: "pending"
  });

  assert.equal(result.ok, false);
  assert.ok(result.issues.some(issue =>
    issue.path === "$.event.sequence" && issue.code === "invalid-integer"
  ));
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

test("accepts the official Radiance fixture set with versioned sources", () => {
  const fixtures = createOfficialRadianceRuleFixtureSet();
  const result = validateRuleFixtureSet(fixtures);

  assert.equal(result.ok, true);
  assert.equal(fixtures.asOf, "2026-10-11T00:00:00.000Z");
  assert.ok(fixtures.cases.length >= 14);
  assert.ok(fixtures.cases.every(item => item.assertions.length > 0));
  assert.ok(fixtures.cases.every(item =>
    item.assertions.every(assertion => assertion.evidence.length > 0)
  ));

  const lifecycle = fixtures.sourceLifecycles.find(
    item => item.sourceId === "riftbound.core-rules"
  );
  assert.notEqual(lifecycle, undefined);
  assert.equal(lifecycle.status, "published");
  assert.equal(lifecycle.publishedAt, "2026-10-09T00:00:00.000Z");
  assert.equal(lifecycle.effectiveAt, "2026-10-16T00:00:00.000Z");
  assert.equal(lifecycle.sha256, "94D41FEE86F88B61C4157C0389C0595D990B98E5B42555C99D9F649EE64D1FEC");
});

test("Radiance fixtures distinguish published sources from active authority", () => {
  const fixtures = createOfficialRadianceRuleFixtureSet();
  const coreLifecycle = fixtures.sourceLifecycles.find(
    item => item.sourceId === "riftbound.core-rules"
  );
  const governanceCase = fixtures.cases.find(
    item => item.id === "source.governance.radiance-effective-window"
  );
  assert.notEqual(coreLifecycle, undefined);
  assert.notEqual(governanceCase, undefined);
  assert.equal(coreLifecycle.status, "published");
  assert.ok(coreLifecycle.publishedAt < fixtures.asOf);
  assert.notEqual(coreLifecycle.effectiveAt, null);
  assert.ok(coreLifecycle.effectiveAt > fixtures.asOf);

  const assertion = governanceCase.assertions[0];
  assert.equal(assertion.expected.active, false);
  assert.equal(
    assertion.expected.reason,
    "published-before-effective-date"
  );
  assert.ok(assertion.evidence.some(item => item.sourceId === "riftbound.radiance-patch-notes"));
});

test("fixture hashes and serialization are stable across key order", () => {
  const fixtures = createOfficialRadianceRuleFixtureSet();
  const reordered = {
    cases: [...fixtures.cases].map(item => ({
      assertions: [...item.assertions].map(assertion => ({
        evidence: [...assertion.evidence],
        expected: assertion.expected,
        given: assertion.given,
        statement: assertion.statement,
        id: assertion.id
      })),
      ...(item.judgeReason === undefined ? {} : { judgeReason: item.judgeReason }),
      decision: item.decision,
      category: item.category,
      id: item.id
    })),
    sourceLifecycles: [...fixtures.sourceLifecycles],
    sources: [...fixtures.sources],
    asOf: fixtures.asOf,
    summary: fixtures.summary,
    title: fixtures.title,
    rulesetId: fixtures.rulesetId,
    id: fixtures.id,
    schemaVersion: fixtures.schemaVersion,
    kind: fixtures.kind
  };

  assert.equal(
    serializeRuleFixtureSet(fixtures),
    serializeRuleFixtureSet(reordered)
  );
  assert.equal(
    stableHashRuleFixtureSet(fixtures),
    stableHashRuleFixtureSet(reordered)
  );
  assert.match(stableHashRuleFixtureSet(fixtures), /^fnv1a64:[0-9a-f]{16}$/);
});

test("judgeRequired fixtures block automatic resolution and cite registered evidence", () => {
  const fixtures = createOfficialRadianceRuleFixtureSet();
  const judgeCases = fixtures.cases.filter(
    item => item.decision === "judgeRequired"
  );
  const sourceKeys = new Set(fixtures.sources.map(serializeEvidenceRef));
  assert.ok(judgeCases.length >= 2);
  assert.ok(judgeCases.every(item => {
    if (
      item.judgeReason === undefined ||
      item.judgeReason.explanation.length === 0 ||
      item.judgeReason.evidence.length === 0 ||
      !item.judgeReason.evidence.every(evidence =>
        sourceKeys.has(serializeEvidenceRef(evidence))
      )
    ) {
      return false;
    }

    return item.assertions.every(assertion => {
      if (assertion.expected.escalation !== "judgeRequired") {
        return false;
      }

      return (
        assertion.expected.autoResolve === false ||
        assertion.expected.engineAppliesTournamentPolicyDefault === false
      );
    });
  }));
});

test("only judgeRequired fixtures may define a reason", () => {
  const fixtures = createOfficialRadianceRuleFixtureSet();
  const invalid = parseRuleFixtureSet(fixtures);

  invalid.cases.forEach((fixtureCase, index) => {
    if (fixtureCase.decision === "judgeRequired") {
      return;
    }

    const modified = structuredClone(invalid);
    modified.cases[index].judgeReason = {
      code: "policy-escalation",
      explanation: `This reason is not allowed for a ${fixtureCase.decision} fixture.`,
      evidence: [...fixtureCase.assertions[0].evidence]
    };
    const result = validateRuleFixtureSet(modified);
    assert.equal(result.ok, false, fixtureCase.decision);
    assert.ok(result.issues.some(issue =>
      issue.path === `$.cases[${index}].judgeReason` &&
      issue.code === "unexpected-judge-reason"
    ), fixtureCase.decision);
  });

  invalid.cases.forEach((fixtureCase, index) => {
    if (fixtureCase.decision !== "judgeRequired") {
      return;
    }

    const missingReason = structuredClone(invalid);
    delete missingReason.cases[index].judgeReason;
    const missingResult = validateRuleFixtureSet(missingReason);
    assert.equal(missingResult.ok, false);
    assert.ok(missingResult.issues.some(issue =>
      issue.path === `$.cases[${index}].judgeReason` &&
      issue.code === "missing-judge-reason"
    ));
  });
});

test("rejects unregistered fixture evidence and source lifecycle mismatches", () => {
  const fixtures = createOfficialRadianceRuleFixtureSet();
  const unregistered = structuredClone(fixtures);
  unregistered.cases[0].assertions[0].evidence[0] = {
    ...unregistered.cases[0].assertions[0].evidence[0],
    ref: "999"
  };
  const evidenceResult = validateRuleFixtureSet(unregistered);
  assert.equal(evidenceResult.ok, false);
  assert.ok(evidenceResult.issues.some(issue =>
    issue.code === "unregistered-evidence"
  ));

  const unregisteredReason = structuredClone(fixtures);
  const judgeCaseIndex = unregisteredReason.cases.findIndex(
    item => item.decision === "judgeRequired"
  );
  unregisteredReason.cases[judgeCaseIndex].judgeReason.evidence[0] = {
    ...unregisteredReason.cases[judgeCaseIndex].judgeReason.evidence[0],
    ref: "999"
  };
  const reasonResult = validateRuleFixtureSet(unregisteredReason);
  assert.equal(reasonResult.ok, false);
  assert.ok(reasonResult.issues.some(issue =>
    issue.path === `$.cases[${judgeCaseIndex}].judgeReason.evidence[0]` &&
    issue.code === "unregistered-evidence"
  ));

  const unknownLifecycle = structuredClone(fixtures);
  unknownLifecycle.sourceLifecycles.push({
    sourceId: "unknown.source",
    status: "published",
    publishedAt: "2026-10-09T00:00:00.000Z",
    effectiveAt: "2026-10-16T00:00:00.000Z",
    effectiveUntil: null,
    sha256: null
  });
  const lifecycleResult = validateRuleFixtureSet(unknownLifecycle);
  assert.equal(lifecycleResult.ok, false);
  assert.ok(lifecycleResult.issues.some(issue =>
    issue.code === "unknown-source-lifecycle"
  ));

  const missingLifecycle = structuredClone(fixtures);
  missingLifecycle.sourceLifecycles.shift();
  const missingResult = validateRuleFixtureSet(missingLifecycle);
  assert.equal(missingResult.ok, false);
  assert.ok(missingResult.issues.some(issue =>
    issue.code === "missing-source-lifecycle"
  ));
});

test("rejects future publications and impossible effective windows", () => {
  const fixtures = createOfficialRadianceRuleFixtureSet();
  const future = structuredClone(fixtures);
  future.sourceLifecycles[0].publishedAt = "2026-10-12T00:00:00.000Z";
  const futureResult = validateRuleFixtureSet(future);
  assert.equal(futureResult.ok, false);
  assert.ok(futureResult.issues.some(issue =>
    issue.code === "future-publication"
  ));

  const prePublicationEffective = structuredClone(fixtures);
  prePublicationEffective.sourceLifecycles[0].effectiveAt = "2026-10-08T00:00:00.000Z";
  const prePublicationResult = validateRuleFixtureSet(prePublicationEffective);
  assert.equal(prePublicationResult.ok, false);
  assert.ok(prePublicationResult.issues.some(issue =>
    issue.code === "invalid-effective-date"
  ));

  const inverted = structuredClone(fixtures);
  inverted.sourceLifecycles[0].effectiveUntil = "2026-10-15T00:00:00.000Z";
  const invertedResult = validateRuleFixtureSet(inverted);
  assert.equal(invertedResult.ok, false);
  assert.ok(invertedResult.issues.some(issue =>
    issue.code === "invalid-effective-window"
  ));

  const historical = structuredClone(fixtures);
  historical.sourceLifecycles[0].status = "historical";
  historical.sourceLifecycles[0].effectiveUntil = null;
  const historicalResult = validateRuleFixtureSet(historical);
  assert.equal(historicalResult.ok, false);
  assert.ok(historicalResult.issues.some(issue =>
    issue.code === "missing-effective-until"
  ));
});

test("rejects hidden hand data in judge event payloads", () => {
  for (const key of [
    "hand",
    "hiddenHand",
    "private_hand",
    "concealed-hand",
    "opponentHand"
  ]) {
    const result = validateJudgeEvent({
      ...event(),
      payload: { [key]: [] }
    });
    assert.equal(result.ok, false, key);
    assert.ok(result.issues.some(issue =>
      issue.code === "private-hand-data"
    ), key);
  }

  const nested = validateJudgeEvent({
    ...event(),
    payload: {
      observed: {
        zones: [{ opponentHand: [{ id: "hidden-card-1" }] }]
      }
    }
  });
  assert.equal(nested.ok, false);
  assert.ok(nested.issues.some(issue =>
    issue.path === "$.payload.observed.zones[0].opponentHand" &&
    issue.code === "private-hand-data"
  ));
});

import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/heart-of-the-tempest.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { validateTriggerSpec } from "../../../../engine-core/dist/events/trigger-spec.js";

const CANONICAL_ID =
  "card.hash-aa310ded3ca355bccab78b17783adac7b21e0b2477c14135b2cf52ebad7d96a5";
const SOURCE_TEXT =
  "When you play a card from anywhere other than your hand, empower me.\n" +
  "[Action][>] Disempower me, :rb_exhaust:: Give a unit [Assault 2] this turn. " +
  "(+2 :rb_might: while it's an attacker.)";

const [triggered, activated] = program.abilities;

test("ven-155-166 Heart of the Tempest: validateCardProgram passes and identity is verbatim", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /fromZone/);
  assert.match(program.judgeReason, /disempower/);
  assert.match(program.judgeReason, /continuous\.grant-keyword/);
});

test("ven-155-166: 'play a card from anywhere other than your hand' trigger shape", () => {
  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.trigger.at, "card-played");
  assert.equal(triggered.optional, false);
  assert.deepEqual(triggered.trigger.filter, {
    event: "card-played",
    filter: { player: "self", notFromHand: true }
  });
  const [empowerSelf] = triggered.body;
  assert.equal(empowerSelf.id, "heart-of-the-tempest.empower-self");
  assert.equal(empowerSelf.op, "effect.empower");
  assert.deepEqual(empowerSelf.args, {
    objects: { kind: "constant", value: { kind: "source" } }
  });
});

test("ven-155-166: [Action][>] ability pays Disempower + Exhaust and grants Assault 2", () => {
  assert.equal(activated.kind, "activated");
  // 806.1.d: [Action][>] marks the following activated ability with the Action
  // permission; the card declares that speed directly on the ability.
  assert.equal(activated.timing, "action");
  assert.deepEqual(activated.cost.payments, [
    { kind: "disempower", object: "self" },
    { kind: "exhaust", object: "self" }
  ]);
  assert.equal(activated.body.length, 1);
  const [grant] = activated.body;
  assert.equal(grant.id, "heart-of-the-tempest.grant-assault");
  assert.equal(grant.op, "continuous.grant-keyword");
  assert.deepEqual(grant.args.keyword, { kind: "constant", value: "Assault" });
  assert.deepEqual(grant.args.value, { kind: "constant", value: 2 });
  assert.deepEqual(grant.args.duration, { kind: "constant", value: "this-turn" });
  assert.deepEqual(grant.targets[0].filter, { type: "unit", zone: "board" });
  assert.equal(grant.targets[0].min, 1);
  assert.equal(grant.targets[0].max, 1);
  assert.equal(grant.targets[0].selection, "one");
});

test("ven-155-166 golden: 'empower me' empowers the legend source through the interpreter", () => {
  const kernel = world()
    .unit("heart-of-the-tempest", { types: ["legend"], zone: "board" })
    .build();
  const context = kernel.clone({
    sourceSnapshot: kernel.getObject("heart-of-the-tempest")
  });

  const outcome = runAbilityBody(triggered.body, context);
  assert.equal(outcome.status, "executed");
  assert.equal(context.getObject("heart-of-the-tempest").empowered, 1);
  assert.deepEqual(context.events.map(event => event.action), ["empower"]);
});

test.todo(
  "ven-155-166: only trigger for a card played from anywhere other than the hand — chain/engine.ts " +
    "emits card-played without a fromZone payload and EventPattern.fromZone is equality-only " +
    "(contract change request, RIFT-120)"
);

test.todo(
  "ven-155-166: pay the printed 'Disempower me' cost — cost/plan-values.ts supports only " +
    "exhaust/discard/recycle/kill/reveal/spend-buff nonstandard payments (RIFT-89)"
);

test.todo(
  "ven-155-166: give a unit [Assault 2] this turn — the card-side continuous.grant-keyword " +
    "instruction with an end-of-turn duration is not merged (RIFT-91 layers engine exists, no " +
    "card-facing op; Assault expansion itself is merged under RIFT-81)"
);

test("ven-155-166: the descriptive not-from-hand filter is rejected by the strict trigger validator", () => {
  // Negative evidence: EventPattern.fromZone is equality-only and the engine
  // ObjectFilter allows no negation key, so the printed "from anywhere other
  // than your hand" cannot be registered until the contract adds it.
  const result = validateTriggerSpec(triggered.trigger);
  assert.equal(result.ok, false);
  assert.ok(
    result.issues.map(issue => issue.code).includes("unknown-field"),
    JSON.stringify(result.issues)
  );
});

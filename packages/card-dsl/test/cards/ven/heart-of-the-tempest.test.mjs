import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/heart-of-the-tempest.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
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
  assert.match(program.judgeReason, /RIFT-261/);
  assert.match(program.judgeReason, /continuous\.grant-keyword/);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
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
  // RIFT-258 merged the op: 807.1.c's "[Assault 2] this turn" is an ability-layer
  // keyword grant with an end-of-turn lifetime (317.1.a / 468.7.c).
  assert.deepEqual(grant.args.keyword, { kind: "constant", value: "Assault" });
  assert.deepEqual(grant.args.value, { kind: "constant", value: 2 });
  assert.deepEqual(grant.args.duration, { kind: "constant", value: "this-turn" });
  assert.deepEqual(grant.args.target, {
    kind: "constant",
    value: "heart-of-the-tempest.unit"
  });
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

test("ven-155-166 golden: '[Assault 2] this turn' grants the keyword through the real primitive", () => {
  const base = world()
    .unit("heart-of-the-tempest", { types: ["legend"], zone: "board", might: null })
    .unit("ally", { zone: "board", might: 3 })
    .build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("heart-of-the-tempest") });
  kernel.setTargets("heart-of-the-tempest.unit", [kernel.ref("ally")]);

  const outcome = runAbilityBody(activated.body, kernel, undefined, {
    host: kernel.ref("heart-of-the-tempest")
  });

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["heart-of-the-tempest.grant-assault", "executed"]
  ]);
  assert.equal(outcome.linkedValues["heart-of-the-tempest.grant-assault.granted.count"], 1);
  assert.deepEqual(outcome.linkedValues["heart-of-the-tempest.grant-assault.granted.objects"], [
    base.ref("ally")
  ]);

  // 478.1.a: keyword grants register in the ability layer; 317.1.a / 468.7.c: the
  // this-turn lifetime expires at turn-end.
  assert.equal(kernel.continuousEffects.length, 1);
  const [registration] = kernel.continuousEffects;
  assert.equal(registration.effect.layer, "ability");
  assert.equal(registration.effect.effect.keyword, "Assault");
  assert.equal(registration.effect.effect.keywordValue, 2);
  assert.deepEqual(registration.duration, { type: "end-of-turn" });

  const layers = createLayerEngine(kernel.objects, kernel.continuousEffects);
  assert.deepEqual(layers.evaluate(kernel.ref("ally")).keywords, [{ id: "Assault", value: 2 }]);
  assert.deepEqual(layers.evaluate(kernel.ref("heart-of-the-tempest")).keywords, []);
  assert.deepEqual(layers.expireAt("turn-end"), [registration.effect.id]);
  assert.deepEqual(layers.evaluate(kernel.ref("ally")).keywords, []);
});

test("ven-155-166 golden: a target that left the board is ignored (359.3.e.6)", () => {
  const base = world()
    .unit("heart-of-the-tempest", { types: ["legend"], zone: "board", might: null })
    .unit("ally", { zone: "board", might: 3 })
    .build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("heart-of-the-tempest") });
  const stale = kernel.ref("ally");
  kernel.perform({ type: "kill", object: stale });
  kernel.setTargets("heart-of-the-tempest.unit", [stale]);

  const outcome = runAbilityBody(activated.body, kernel, undefined, {
    host: kernel.ref("heart-of-the-tempest")
  });
  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results[0].result, { status: "ignored", reason: "mistargeted" });
  assert.equal(kernel.continuousEffects.length, 0);
});

test.todo(
  "ven-155-166: only trigger for a card played from anywhere other than the hand — chain/engine.ts " +
    "emits card-played without a fromZone payload and EventPattern.fromZone is equality-only " +
    "(contract change request); the descriptive notFromHand filter is rejected by the strict " +
    "validator and by RIFT-257's trigger binding"
);

test.todo(
  "ven-155-166: pay the printed 'Disempower me' cost — cost/plan-values.ts supports only " +
    "exhaust/discard/recycle/kill/reveal/spend-buff nonstandard payments (RIFT-261)"
);

test("ven-155-166: the printed 'from anywhere other than your hand' filter is rejected by the strict validator", () => {
  // 保留的负向证据：EventPattern.fromZone 只做等值匹配、ObjectFilter 也不接受否定键，
  // 因此印刷的 “from anywhere other than your hand” 在契约补齐前无法注册（judgeReason 1）。
  const result = validateTriggerSpec(triggered.trigger);
  assert.equal(result.ok, false);
  assert.ok(
    result.issues.map(issue => issue.code).includes("unknown-field"),
    JSON.stringify(result.issues)
  );
});

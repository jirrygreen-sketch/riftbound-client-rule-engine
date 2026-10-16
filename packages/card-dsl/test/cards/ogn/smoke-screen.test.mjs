import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/smoke-screen.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";

const CARD_ID = "card.hash-e97af51e4273d0e357336eeb9843588d53ddb174bbf2fe8c0ce001f8f5cc3674";
const SOURCE_TEXT =
  "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
  "Give a unit -4 :rb_might: this turn, to a minimum of 1 :rb_might:.";

const [reactionKeyword, play] = program.abilities;
const [debuff] = play.body;

const registrations = (kernel) => kernel.continuousEffects.map(entry => ({
  effect: entry.effect,
  duration: entry.duration,
  timestamp: 1
}));

const effectiveMight = (kernel, id) =>
  createLayerEngine(kernel.objects, registrations(kernel)).evaluate(kernel.ref(id)).might;

function debuffWorld(might) {
  const kernel = world().unit("target-unit", { owner: "B", controller: "B", might }).build();
  kernel.setTargets("smoke-screen.unit", [kernel.ref("target-unit")]);
  return kernel;
}

test("ogn-093-298 Smoke Screen: program passes validateCardProgram and is executable", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("ogn-093-298 Smoke Screen structure: [Reaction] keyword plus one targeted -4 Might instruction", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(reactionKeyword, { kind: "keyword", keyword: "reaction" });
  assert.equal(reactionKeyword.value, undefined);
  assert.equal(play.kind, "play");
  assert.equal(play.cost, undefined);
  assert.equal(play.body.length, 1);
  assert.equal(debuff.id, "smoke-screen.debuff");
  assert.equal(debuff.op, "continuous.might");
  assert.equal(debuff.linkedTo, undefined);
  assert.equal(debuff.picks, undefined);
  assert.equal(debuff.condition, undefined);

  // "Give a unit -4 Might this turn": the printed -4 with a per-turn duration.
  assert.deepEqual(debuff.args.amount, { kind: "constant", value: -4 });
  assert.deepEqual(debuff.args.duration, { kind: "constant", value: "this-turn" });
  // "to a minimum of 1 Might" is the printing's own floor (479.4.b), not the
  // generic 143.2.c rule, so it is carried as the modification's floor.
  assert.deepEqual(debuff.args.minimum, { kind: "constant", value: 1 });
  assert.deepEqual(debuff.args.objects, {
    kind: "constant",
    value: { kind: "target", id: "smoke-screen.unit" }
  });

  // "a unit" — exactly one Board unit, any controller (355.7/355.9.a.1).
  assert.deepEqual(debuff.targets, [
    {
      id: "smoke-screen.unit",
      filter: { type: "unit" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
});

test("ogn-093-298 Smoke Screen golden: -4 Might registers an end-of-turn arithmetic effect on the locked unit", () => {
  const kernel = debuffWorld(6);
  const outcome = resolveChainBody(play.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map(result => [result.id, result.result.status]),
    [["smoke-screen.debuff", "executed"]]
  );
  assert.equal(kernel.continuousEffects.length, 1);
  const [registration] = kernel.continuousEffects;
  // 478 / 478.1.a: Might modifications live in the arithmetic layer, applied by
  // ctx.addContinuous with the printed minimum snapshotted (479.4.b).
  assert.equal(registration.effect.layer, "arithmetic");
  assert.equal(registration.effect.effect.kind, "continuous.might");
  assert.equal(registration.effect.effect.minimum, 1);
  assert.deepEqual(registration.effect.filter.objectId, "target-unit");
  assert.deepEqual(registration.duration, { type: "end-of-turn" });

  // 143.2.a: the effective Might drops by the printed -4 and no floor is hit.
  assert.equal(effectiveMight(kernel, "target-unit"), 2);
});

test("ogn-093-298 Smoke Screen golden: the printed minimum of 1 is snapshotted, not the layer engine's 0 floor", () => {
  // 479.4.b: a unit with 2 Might given "-4 to a minimum of 1" receives -1 and
  // stays at 1; the generic arithmetic pass would floor at 0 instead.
  const kernel = debuffWorld(2);
  resolveChainBody(play.body, kernel);
  assert.equal(kernel.continuousEffects[0].effect.effect.amount, -1);
  assert.equal(effectiveMight(kernel, "target-unit"), 1);

  // A unit already at 1 receives a 0 Might modification: the minimum still
  // holds and the unit is not pushed to 0.
  const weakest = debuffWorld(1);
  resolveChainBody(play.body, weakest);
  assert.equal(effectiveMight(weakest, "target-unit"), 1);
});

test("ogn-093-298 Smoke Screen golden: the modification expires at end of turn (317.1.a / 468.7.c)", () => {
  const kernel = debuffWorld(6);
  resolveChainBody(play.body, kernel);
  const engine = createLayerEngine(kernel.objects, registrations(kernel));
  assert.equal(engine.evaluate(kernel.ref("target-unit")).might, 2);

  const expired = engine.expireAt("turn-end");
  assert.equal(expired.length, 1);
  assert.equal(engine.evaluate(kernel.ref("target-unit")).might, 6);
});

test("ogn-093-298 Smoke Screen golden: a target that left the Board is ignored (359.3.e.6)", () => {
  const kernel = debuffWorld(6);
  const stale = kernel.ref("target-unit");
  kernel.perform({ type: "kill", object: stale });
  kernel.setTargets("smoke-screen.unit", [stale]);

  const outcome = resolveChainBody(play.body, kernel);
  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results[0].result, { status: "ignored", reason: "mistargeted" });
  assert.equal(kernel.continuousEffects.length, 0);
  assert.equal(kernel.getObject("target-unit").might, 6);
});

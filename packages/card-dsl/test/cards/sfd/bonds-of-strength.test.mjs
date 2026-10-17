import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/bonds-of-strength.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { finalizeTargetPlan, resolveTargetPlan } from "../../../../engine-core/dist/target/target-plan.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-13ba5efe94e7668b6570b551c230fecd5395f082448d8a86f0ba8b2f23b78626";
const SOURCE_TEXT =
  "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
  "[Repeat] :rb_energy_2: (You may pay the additional cost to repeat this spell's effect.)\n" +
  "Give two friendly units each +1 :rb_might: this turn.";

const [reaction, play] = program.abilities;
const [grantMight] = play.body;
const unitSpec = grantMight.targets[0];

/**
 * The reference kernel compares raw filter values, so the merged chain's
 * normalization of the static "self" controller spelling (chain/engine.ts
 * turns it into the ability controller) is replayed here. The card's own spec
 * is asserted separately below and stays symbolic.
 */
const requirement = {
  id: unitSpec.id,
  filter: { ...unitSpec.filter, controller: "A" },
  min: unitSpec.min,
  max: unitSpec.max,
  selection: unitSpec.selection
};

/** Production card-body path with the chain's controller normalization. */
const productionContext = (kernel) => bindResolveContext(kernel, {
  query: (filter) => kernel.objects.filter((object) => matchesObjectFilter(
    Object.fromEntries(Object.entries(filter).map(([key, value]) => [
      key,
      key === "controller" && value === "self" ? kernel.controller : value
    ])),
    object
  ))
});

const registrations = (kernel) => kernel.continuousEffects.map((entry) => ({
  effect: entry.effect,
  duration: entry.duration,
  timestamp: 1
}));

const effectiveMight = (kernel, id) =>
  createLayerEngine(kernel.objects, registrations(kernel)).evaluate(kernel.ref(id)).might;

function pairWorld({ firstMight = 2, secondMight = 3 } = {}) {
  const kernel = world()
    .player("A")
    .unit("first-unit", { owner: "A", controller: "A", might: firstMight })
    .unit("second-unit", { owner: "A", controller: "A", might: secondMight })
    .unit("enemy-unit", { owner: "B", controller: "B", might: 2 })
    .build();
  kernel.setTargets(unitSpec.id, [kernel.ref("first-unit"), kernel.ref("second-unit")]);
  return kernel;
}

test("sfd-151-221 Bonds of Strength: program passes validateCardProgram and is executable", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("sfd-151-221 Bonds of Strength: [Reaction] keyword and the Might grant" , () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(reaction, { kind: "keyword", keyword: "reaction" });
  assert.equal(reaction.value, undefined);
  assert.equal(play.kind, "play");
  assert.equal(play.body.length, 1);

  // 143.2.a / 317.2.c: the +1 Might lasts for this turn (all "this turn"
  // effects expire together in cleanup); the arithmetic-layer registration and
  // the end-of-turn duration are carried by the merged continuous.might
  // primitive, never by a Buff counter (703).
  assert.equal(grantMight.id, "bonds-of-strength.grant-might");
  assert.equal(grantMight.op, "continuous.might");
  assert.equal(grantMight.linkedTo, undefined);
  assert.deepEqual(grantMight.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(grantMight.args.duration, { kind: "constant", value: "this-turn" });
  // 契约 3.6: the locked group is read through the symbolic selector, never a
  // runtime ObjectRef in static IR.
  assert.deepEqual(grantMight.args.objects, {
    kind: "constant",
    value: { kind: "target", id: "bonds-of-strength.units" }
  });
  assert.equal(grantMight.args.target, undefined);
});

test("sfd-151-221 Bonds of Strength: one fixed two-unit friendly target group (355.9.b)", () => {
  assert.equal(grantMight.targets.length, 1);
  // "two friendly units": a fixed pair, so min 2 / max 2 rather than "up to"
  // (355.13 would allow zero), the merged ogn/back-to-back shape.
  assert.deepEqual(unitSpec, {
    id: "bonds-of-strength.units",
    filter: { type: "unit", zone: "board", controller: "self" },
    min: 2,
    max: 2,
    selection: "any"
  });
});

test("sfd-151-221 Bonds of Strength golden: the merged target system locks exactly two friendly units", () => {
  const kernel = world()
    .unit("first-unit", { owner: "A", controller: "A" })
    .unit("second-unit", { owner: "A", controller: "A" })
    .unit("third-unit", { owner: "A", controller: "A" })
    .unit("enemy-unit", { owner: "B", controller: "B" })
    .build();
  kernel.setAnswers({
    ["target:" + unitSpec.id]: [kernel.ref("first-unit"), kernel.ref("third-unit")]
  });

  const plan = finalizeTargetPlan(kernel, requirement);
  assert.equal(plan.selected.length, 2);
  assert.deepEqual(plan.selected.map((ref) => ref.id), ["first-unit", "third-unit"]);
  assert.equal(resolveTargetPlan(kernel, plan).status, "resolved");
});

test("sfd-151-221 Bonds of Strength golden: fewer than two friendly units cannot finalize (355.8)", () => {
  const kernel = world()
    .unit("only-unit", { owner: "A", controller: "A" })
    .unit("enemy-unit", { owner: "B", controller: "B" })
    .build();

  // 355.8: valid choices must be made for all targets before the spell goes on
  // the chain, and the printed pair is fixed, so one friendly unit is not
  // enough — the merged target system rejects the finalize instead of playing
  // for less.
  assert.throws(() => finalizeTargetPlan(kernel, requirement), /required target count/);
});

test("sfd-151-221 Bonds of Strength golden: the grant registers one end-of-turn arithmetic effect per unit", () => {
  const kernel = pairWorld();
  const outcome = resolveChainBody(play.body, productionContext(kernel));

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map((result) => [result.id, result.result.status]), [
    ["bonds-of-strength.grant-might", "executed"]
  ]);
  // 478 / 478.1.a: the Might modification lives in the arithmetic layer and is
  // committed through ctx.addContinuous with the printed end-of-turn duration.
  assert.equal(kernel.continuousEffects.length, 2);
  for (const registration of kernel.continuousEffects) {
    assert.equal(registration.effect.layer, "arithmetic");
    assert.equal(registration.effect.effect.kind, "continuous.might");
    assert.equal(registration.effect.effect.amount, 1);
    assert.deepEqual(registration.duration, { type: "end-of-turn" });
  }
  assert.deepEqual(
    kernel.continuousEffects.map((registration) => registration.effect.filter.objectId).sort(),
    ["first-unit", "second-unit"]
  );

  // 143.2.a: both friendly units read +1 Effective Might; the enemy unit that
  // is not in the fixed group is untouched.
  assert.equal(effectiveMight(kernel, "first-unit"), 3);
  assert.equal(effectiveMight(kernel, "second-unit"), 4);
  assert.equal(effectiveMight(kernel, "enemy-unit"), 2);
});

test("sfd-151-221 Bonds of Strength golden: the +1 Might expires with the end-of-turn cleanup (317.2.c)", () => {
  const kernel = pairWorld();
  resolveChainBody(play.body, productionContext(kernel));
  const engine = createLayerEngine(kernel.objects, registrations(kernel));
  assert.equal(engine.evaluate(kernel.ref("first-unit")).might, 3);

  const expired = engine.expireAt("turn-end");
  assert.equal(expired.length, 2);
  assert.equal(engine.evaluate(kernel.ref("first-unit")).might, 2);
  assert.equal(engine.evaluate(kernel.ref("second-unit")).might, 3);
});

test("sfd-151-221 Bonds of Strength golden: a member of the locked pair that left the board is dropped (359.3.e.8)", () => {
  // 359.3.e.8: a partially mistargeted group keeps its still-legal members, so
  // the surviving friendly unit receives its +1 and the stale one is excluded
  // from the resolution instead of being rebound by id.
  const kernel = pairWorld();
  const stale = kernel.ref("second-unit");
  assert.equal(kernel.perform({ type: "kill", object: stale }).status, "done");
  kernel.setTargets(unitSpec.id, [kernel.ref("first-unit"), stale]);

  const outcome = resolveChainBody(play.body, productionContext(kernel));

  assert.equal(outcome.results[0].result.status, "executed");
  assert.deepEqual(outcome.results[0].result.linkedValues.affected, {
    count: 1,
    objects: [kernel.ref("first-unit")]
  });
  assert.equal(kernel.continuousEffects.length, 1);
  assert.equal(kernel.continuousEffects[0].effect.filter.objectId, "first-unit");
  assert.equal(effectiveMight(kernel, "first-unit"), 3);
  // 702/703: no Buff counter stands in for the Might change, and the dead unit
  // is not resurrected or modified.
  assert.equal(kernel.getObject("first-unit").buffs, 0);
  assert.equal(kernel.getObject("second-unit").zone, "trash");
});

test("sfd-151-221 Bonds of Strength golden: a fully stale pair is ignored and registers nothing", () => {
  // 359.3.e.7: when every locked member is gone the instruction is ignored, so
  // an unavailable group can never produce a Might grant.
  const kernel = pairWorld();
  const firstStale = kernel.ref("first-unit");
  const secondStale = kernel.ref("second-unit");
  assert.equal(kernel.perform({ type: "kill", object: firstStale }).status, "done");
  assert.equal(kernel.perform({ type: "kill", object: secondStale }).status, "done");
  const eventCount = kernel.events.length;
  kernel.setTargets(unitSpec.id, [firstStale, secondStale]);

  const outcome = resolveChainBody(play.body, productionContext(kernel));

  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results[0].result, { status: "ignored", reason: "mistargeted" });
  assert.equal(kernel.continuousEffects.length, 0);
  assert.equal(kernel.events.length, eventCount);
});

test.todo(
  "sfd-151-221 Bonds of Strength: [Repeat] :rb_energy_2: — collecting the optional additional cost at Finalize " +
    "and executing the effect one extra time per paid instance with re-made choices " +
    "(820.1.b/820.1.d/820.2.a) needs the Repeat keyword expansion (RIFT-86) and the cost plan (RIFT-89)"
);

test.todo(
  "sfd-151-221 Bonds of Strength: the printed [Reaction] Closed-State permission and the chain admission " +
    "(813.1.c, contract 3.5 canAct) need a CardProgram -> ChainDraft play adapter — RIFT-257"
);

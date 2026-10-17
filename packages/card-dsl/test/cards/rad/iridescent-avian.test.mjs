// Golden test for Iridescent Avian (rad-027-167).
//
// status: executable. The exhaust cost, effect.buff and the conditional
// temporary Might change (continuous.might + condition.value) are all merged,
// so both printed branches execute for real against the reference kernel.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/iridescent-avian.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { payCostPlan } from "../../../../engine-core/dist/cost/payment.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL =
  "card.hash-8dc527406dd2ec53dd9af597138cb888f1548f0de5158dc5477e8c34b25afda8";
const SOURCE_TEXT =
  ":rb_exhaust:: [Buff] a unit. If it's already buffed, give it +2 :rb_might: this turn instead. " +
  "(To buff a unit, give it a +1 :rb_might: buff if it doesn't have one.)";

const [activated] = program.abilities;
const [readBuffed, buffInstruction, plusTwo] = activated.body;

// The reference kernel compares contract-layer controller anchors verbatim, so
// the goldens lock the target through setTargets and run the card's own body
// (the improvised-projectile / one-two-punch convention). The TargetSpec below
// is asserted structurally instead.
const bodyWithoutTargets = (body) => body.map(({ targets, ...rest }) => rest);

function fixture(buffs) {
  const kernel = world()
    .unit("avian", { might: 3 })
    .unit("target", { might: 2, buffs })
    .build();
  kernel.setTargets("iridescent-avian.unit", [kernel.ref("target")]);
  return kernel;
}

test("rad-027-167 Iridescent Avian: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("rad-027-167 Iridescent Avian: identity, executable status and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("rad-027-167 Iridescent Avian: one action-speed activation whose cost is exhausting itself", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(activated.kind, "activated");
  assert.equal(activated.timing, "action");
  // CR 415.3.a / 415.5: :rb_exhaust: is this ability's cost, paid at Finalize.
  assert.deepEqual(activated.cost, {
    kind: "activated",
    payments: [{ kind: "exhaust" }]
  });
});

test("rad-027-167 Iridescent Avian: the 'already buffed' read is frozen before the Buff step", () => {
  // "If it's already buffed" is decided once, at resolution start: the buff
  // count is read into a linked value (contract 3.9 condition.value) rather
  // than re-read after the Buff action could have changed it.
  assert.equal(readBuffed.op, "condition.value");
  assert.deepEqual(readBuffed.args, {
    value: {
      kind: "object-attribute",
      object: { target: "iridescent-avian.unit" },
      attribute: "buffs"
    },
    key: { kind: "constant", value: "alreadyBuffed" }
  });
  assert.deepEqual(readBuffed.targets, [
    {
      id: "iridescent-avian.unit",
      filter: { type: "unit", zone: "board" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);

  // "[Buff] a unit" is a merged effect.buff on that one chosen unit
  // (355.7/355.10.a), linked to the frozen read.
  assert.equal(buffInstruction.op, "effect.buff");
  assert.deepEqual(buffInstruction.args, {
    mode: { kind: "constant", value: "buff" },
    target: { kind: "constant", value: "iridescent-avian.unit" }
  });
  assert.equal(buffInstruction.linkedTo, "iridescent-avian.read-buffed");

  // "instead": the +2 Might step carries the guard as its own condition
  // (contract 3.4), reading the frozen value.
  assert.equal(plusTwo.op, "continuous.might");
  assert.deepEqual(plusTwo.args.amount, { kind: "constant", value: 2 });
  // CR 317.2.c: "this turn" expires in the end-of-turn cleanup.
  assert.deepEqual(plusTwo.args.duration, { kind: "constant", value: "end-of-turn" });
  assert.deepEqual(plusTwo.condition, {
    kind: "compare",
    left: {
      kind: "linked-value",
      instructionId: "iridescent-avian.read-buffed",
      key: "alreadyBuffed"
    },
    operator: "gt",
    right: { kind: "constant", value: 0 }
  });
  assert.equal(plusTwo.linkedTo, "iridescent-avian.buff");
});

test("rad-027-167 Iridescent Avian: an unbuffed unit really gains exactly one Buff and no Might change", () => {
  const kernel = fixture(0);
  const outcome = runAbilityBody(bodyWithoutTargets(activated.body), kernel);

  // 427.2.a: the Buff is placed; the +2 branch is skipped (the unit was not
  // already buffed), so no temporary Might effect is registered.
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status]),
    [
      ["iridescent-avian.read-buffed", "executed"],
      ["iridescent-avian.buff", "executed"],
      ["iridescent-avian.plus-2", "negated"]
    ]
  );
  assert.equal(kernel.getObject("target").buffs, 1);
  assert.equal(outcome.linkedValues["iridescent-avian.read-buffed.alreadyBuffed"], 0);
  assert.equal(kernel.continuousEffects.length, 0);
  assert.deepEqual(
    outcome.events.map((event) => event.action),
    ["buff"]
  );
});

test("rad-027-167 Iridescent Avian: an already buffed unit gets +2 Might this turn instead", () => {
  const kernel = fixture(1);
  const outcome = runAbilityBody(bodyWithoutTargets(activated.body), kernel);

  // 427.1.c / 702.3.a: the unit may be chosen but gains no second Buff, so the
  // Buff step is negated/skipped and the +2 branch executes instead.
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status, entry.result.reason ?? null]),
    [
      ["iridescent-avian.read-buffed", "executed", null],
      ["iridescent-avian.buff", "negated", "skipped"],
      ["iridescent-avian.plus-2", "executed", null]
    ]
  );
  assert.equal(kernel.getObject("target").buffs, 1);
  assert.equal(outcome.linkedValues["iridescent-avian.read-buffed.alreadyBuffed"], 1);
  assert.equal(kernel.events.length, 0);

  // The registered arithmetic effect is a real +2, and it expires at turn end
  // (317.2.c / 478.1.a).
  assert.equal(kernel.continuousEffects.length, 1);
  const registration = kernel.continuousEffects[0];
  assert.equal(registration.effect.layer, "arithmetic");
  assert.equal(registration.effect.effect.kind, "continuous.might");
  assert.equal(registration.effect.effect.amount, 2);
  assert.deepEqual(registration.duration, { type: "end-of-turn" });

  const layers = createLayerEngine([kernel.getObject("target")], kernel.continuousEffects);
  assert.equal(layers.evaluate(kernel.ref("target")).might, 4);
  assert.deepEqual(layers.advance({ id: "turn-end" }), [registration.effect.id]);
  assert.equal(layers.evaluate(kernel.ref("target")).might, 2);
});

test("rad-027-167 Iridescent Avian: a target that left the Board ignores the whole body (359.3.e.7)", () => {
  const kernel = fixture(0);
  const stale = kernel.ref("target");
  kernel.perform({ type: "kill", object: stale });
  kernel.setTargets("iridescent-avian.unit", [stale]);

  const outcome = runAbilityBody(bodyWithoutTargets(activated.body), kernel);
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status, entry.result.reason]),
    [
      ["iridescent-avian.read-buffed", "ignored", "mistargeted"],
      ["iridescent-avian.buff", "ignored", "linked-ignored"],
      ["iridescent-avian.plus-2", "ignored", "linked-ignored"]
    ]
  );
  assert.equal(kernel.continuousEffects.length, 0);
});

test("rad-027-167 Iridescent Avian: exhausting the source really pays the printed cost", () => {
  const kernel = world().unit("avian", { might: 3 }).build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("avian") });
  const plan = buildCostPlan(context, { id: "avian.activate", cost: activated.cost });
  assert.deepEqual(plan.total.energy, 0);
  assert.deepEqual(plan.total.power, []);
  assert.equal(plan.total.actions.length, 1);
  assert.deepEqual(plan.total.actions[0].action, {
    type: "exhaust",
    object: kernel.ref("avian")
  });
  const paid = payCostPlan(context, plan);
  assert.equal(paid.paid, true);
  assert.equal(context.getObject("avian").exhausted, true);
  // A second copy of the same cost is unpayable while the source stays exhausted.
  assert.throws(
    () => payCostPlan(context, plan),
    /An exhaust cost requires a ready controlled object/
  );
});

test("rad-027-167 Iridescent Avian: the same body resolves through the production chain adapter", () => {
  // The chain adapter wraps primitive args for the v1 schemas; both branches
  // must still reach the same result as the plain interpreter path.
  for (const [buffs, expected] of [
    [0, [["iridescent-avian.buff", "executed"], ["iridescent-avian.plus-2", "negated"]]],
    [1, [["iridescent-avian.buff", "negated"], ["iridescent-avian.plus-2", "executed"]]]
  ]) {
    const kernel = fixture(buffs);
    const outcome = resolveChainBody(bodyWithoutTargets(activated.body), kernel);
    assert.deepEqual(
      outcome.results.slice(1).map((entry) => [entry.id, entry.result.status]),
      expected
    );
    assert.equal(kernel.continuousEffects.length, buffs === 1 ? 1 : 0);
  }
});

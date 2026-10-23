// Golden test for Invigorating Bloom (rad-035-167).
//
// judge-required (see the program's judgeReason): the printed "Exhaust a
// friendly [Mighty] unit" cost cannot be built from static IR — cost/plan-values
// choiceObjects still demands exact ObjectRefs, and the filter vocabulary has no
// current-Might>=5 predicate for CR 710. The play trigger's +3 Might, the
// source-exhaust cost and Draw 1 are merged and executed for real below.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/invigorating-bloom.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { readCost } from "../../../../engine-core/dist/cost/plan-values.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { payCostPlan } from "../../../../engine-core/dist/cost/payment.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { createActionPipelineHost, bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { translateObjectFilter } from "../../../../engine-core/dist/programs/filters.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

/** Minimal engine so the production static binder can be exercised directly. */
function binderFor(kernel) {
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: checkpoint => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: () => { throw new Error("Unexpected choice"); },
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint }),
    testTrigger: () => true
  });
  const engine = new ChainEngine({
    turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false
  });
  return createEngineStaticBinder(engine);
}

const CANONICAL =
  "card.hash-22d854738a427311b36ac63f3aaf6f45c1c921fc638e338c8a2144a374c635e7";
const SOURCE_TEXT =
  "When you play this, give a friendly unit +3 :rb_might: this turn.\n" +
  "Exhaust a friendly [Mighty] unit, :rb_exhaust:: Draw 1. (A unit is Mighty while it has 5+ :rb_might:.)";

const [playEffect, activated] = program.abilities;
const [giveMight] = playEffect.body;
const [costUnitPayment, costSelfPayment] = activated.cost.payments;
const [drawInstruction] = activated.body;

// The reference kernel compares contract-layer controller anchors verbatim, so
// the +3 Might golden locks the target through setTargets and runs the card's
// own body; the TargetSpec is asserted structurally instead.
const bodyWithoutTargets = (body) => body.map(({ targets, ...rest }) => rest);

test("rad-035-167 Invigorating Bloom: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("rad-035-167 Invigorating Bloom: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  // README §2: name the remaining missing pieces precisely.
  assert.match(program.judgeReason, /355\.10\.c\.1/);
  assert.match(program.judgeReason, /精确 ObjectRef/);
  assert.match(program.judgeReason, /费用侧没有 filter\/query 形状/);
  assert.match(program.judgeReason, /710/);
  assert.match(program.judgeReason, /cardType Unit/);
  // The refreshed reason records the two measured rejections and the Mighty
  // layer gap with merged code names.
  assert.match(program.judgeReason, /Unsupported payment field: filter/);
  assert.match(program.judgeReason, /mightGte/);
  assert.match(program.judgeReason, /condition\.value has no layer mapping/);
  // The old reason cited cost/plan-values.ts as a *filter* gap and claimed the
  // keyword declaration alone was the missing piece; the merged binder rejects
  // the exact-reference requirement instead.
  assert.doesNotMatch(program.judgeReason, /RIFT-89|RIFT-91|RIFT-120|RIFT-257/);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("rad-035-167 Invigorating Bloom: 'When you play this' give-+3-Might trigger", () => {
  assert.equal(playEffect.kind, "triggered");
  assert.deepEqual(playEffect.trigger, {
    at: "card-played",
    filter: { event: "card-played", filter: { source: "self", player: "self" } }
  });
  assert.equal(playEffect.optional, false);
  // "give a friendly unit +3 Might this turn" — temporary Might, not a Buff.
  assert.equal(giveMight.op, "continuous.might");
  assert.deepEqual(giveMight.args.amount, { kind: "constant", value: 3 });
  assert.deepEqual(giveMight.args.duration, { kind: "constant", value: "end-of-turn" });
  // Contract 3.6: the selector is the continuous-effect "objects" spelling.
  assert.deepEqual(giveMight.args.objects, {
    kind: "constant",
    value: { kind: "target", id: "invigorating-bloom.friendly-unit" }
  });
  assert.deepEqual(giveMight.targets, [
    {
      id: "invigorating-bloom.friendly-unit",
      filter: { type: "unit", zone: "board", controller: "controller" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
});

test("rad-035-167 Invigorating Bloom: the activation cost is a Mighty unit plus exhausting itself", () => {
  // CR 355.10.c.1: the [do X] to [do Y] exhaust is an instruction cost, not a target.
  assert.equal(costUnitPayment.kind, "exhaust");
  assert.equal(costUnitPayment.choice.id, "invigorating-bloom.mighty-unit");
  assert.equal(costUnitPayment.choice.mighty, true);
  assert.equal(costUnitPayment.choice.zone, "board");
  assert.equal(costUnitPayment.choice.owner, "controller");
  assert.equal(costUnitPayment.choice.selection, "one");
  // The merged cost planner still requires exact ObjectRefs in options, so the
  // declared candidate list cannot become a payable plan (see the boundary test).
  assert.deepEqual(costUnitPayment.choice.options, ["friendly-mighty-unit-on-board"]);
  assert.equal(costUnitPayment.choice.filter, undefined);
  // CR 415.3.a / 415.5: :rb_exhaust: pays by exhausting the source.
  assert.deepEqual(costSelfPayment, { kind: "exhaust", object: "self" });
  assert.equal(activated.timing, "action");
});

test("rad-035-167 Invigorating Bloom: 'Draw 1' is a plain controller draw (414.3 / 190.6.d)", () => {
  assert.equal(drawInstruction.id, "invigorating-bloom.draw-1");
  assert.equal(drawInstruction.op, "effect.draw");
  assert.deepEqual(drawInstruction.args, {
    amount: { kind: "constant", value: 1 }
  });
  assert.equal(drawInstruction.linkedTo, undefined);
});

test("rad-035-167 Invigorating Bloom: the play trigger really gives +3 Might for this turn only", () => {
  const kernel = world()
    .unit("bloom", { might: 3 })
    .unit("ally", { might: 2 })
    .build();
  kernel.setTargets("invigorating-bloom.friendly-unit", [kernel.ref("ally")]);

  const outcome = runAbilityBody(bodyWithoutTargets(playEffect.body), kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(kernel.continuousEffects.length, 1);

  // 478.1.a: the registration is an arithmetic-layer +3; 317.2.c ends it at
  // the end-of-turn cleanup.
  const registration = kernel.continuousEffects[0];
  assert.equal(registration.effect.layer, "arithmetic");
  assert.equal(registration.effect.effect.kind, "continuous.might");
  assert.equal(registration.effect.effect.amount, 3);
  assert.deepEqual(registration.duration, { type: "end-of-turn" });
  assert.deepEqual(outcome.linkedValues["invigorating-bloom.give-might.affected"], {
    count: 1,
    objects: [kernel.ref("ally")]
  });

  const layers = createLayerEngine(
    [kernel.getObject("bloom"), kernel.getObject("ally")],
    kernel.continuousEffects
  );
  assert.equal(layers.evaluate(kernel.ref("ally")).might, 5);
  // Only the chosen unit is modified.
  assert.equal(layers.evaluate(kernel.ref("bloom")).might, 3);
  assert.deepEqual(layers.advance({ id: "turn-end" }), [registration.effect.id]);
  assert.equal(layers.evaluate(kernel.ref("ally")).might, 2);
});

test("rad-035-167 Invigorating Bloom: the Draw 1 half really draws and exhausts nothing extra", () => {
  const kernel = world().hand("bloom").deck(["card-1"]).deck(["card-2"]).build();
  const run = runInstruction(draw, drawInstruction.args, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 1);
  assert.equal(run.linked.drawnTo, "A");
  assert.equal(kernel.player("A").handSize, 2);
  // "Draw 1" is not an exhaust: the source is untouched by the draw step.
  assert.equal(kernel.getObject("bloom").exhausted, false);
});

test("rad-035-167 Invigorating Bloom: the self-exhaust half of the cost is really payable", () => {
  // The Mighty-unit half cannot be built from static IR (see the todo below), so
  // only the source-exhaust component is measured here against the real planner.
  const kernel = world().unit("bloom", { might: 3 }).unit("mighty-unit", { might: 5 }).build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("bloom") });
  const plan = buildCostPlan(context, {
    id: "bloom.activate",
    cost: { kind: "activated", payments: [costSelfPayment] }
  });
  assert.equal(plan.total.actions.length, 1);
  assert.deepEqual(plan.total.actions[0].action, {
    type: "exhaust",
    object: kernel.ref("bloom")
  });
  assert.equal(payCostPlan(context, plan).paid, true);
  assert.equal(context.getObject("bloom").exhausted, true);
});

test("rad-035-167 Invigorating Bloom golden: a locked Mighty object plans both Exhaust payments", () => {
  const kernel = world().unit("bloom", { might: 3 }).unit("mighty-unit", { might: 5 }).build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("bloom") });
  context.setPicks("invigorating-bloom.mighty-unit", [kernel.ref("mighty-unit")]);
  const plan = buildCostPlan(context, {
    id: "bloom.activate",
    cost: {
      kind: "activated",
      payments: [{ ...costUnitPayment, choice: costUnitPayment.choice }, { kind: "exhaust", object: kernel.ref("bloom") }]
    }
  });
  assert.deepEqual(plan.total.actions.map(entry => entry.action.type), ["exhaust", "exhaust"]);
  assert.equal(payCostPlan(context, plan).paid, true);
  assert.equal(context.getObject("mighty-unit").exhausted, true);
  assert.equal(context.getObject("bloom").exhausted, true);
});

test("rad-035-167 Invigorating Bloom gap: a filter-shaped cost payment and a Mighty predicate are both rejected", () => {
  // Both halves of the printed cost clause are measured here: the payment
  // schema has no filter entry at all, and the filter vocabulary has no
  // current-Might predicate for CR 710.
  const kernel = world().unit("bloom", { might: 3 }).unit("mighty-unit", { might: 5 }).build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("bloom") });
  assert.throws(
    () => readCost(
      context,
      { payments: [{ kind: "exhaust", filter: { type: "unit", characteristics: { might: 5 } } }] },
      { id: "bloom.activate" },
      "bloom.activate"
    ),
    error => error.name === "CostPlanError" && /Unsupported payment field: filter/.test(error.message)
  );
  assert.throws(
    () => translateObjectFilter({ type: "unit", mighty: true }),
    error => error.code === "judge-required" && /Unsupported filter field mighty/.test(error.message)
  );
  assert.deepEqual(translateObjectFilter({ type: "unit", mightGte: 5 }), {
    type: "unit",
    mightGte: 5
  });
  // characteristics is a literal equality test, not the 710 threshold: a unit
  // with Might 6 does not satisfy a Might-5 characteristic clause.
  assert.equal(matchesObjectFilter({ characteristics: { might: 5 } }, { ...kernel.getObject("mighty-unit"), might: 6 }), false);
  assert.equal(matchesObjectFilter({ characteristics: { might: 5 } }, kernel.getObject("mighty-unit")), true);
});

test("rad-035-167 Invigorating Bloom gap: Mighty's condition.value description has no static layer mapping", () => {
  // effects/keywords/Mighty.ts does describe 706-711 as condition.value, but the
  // production static binder cannot register that kind, so its predicate is not
  // reachable from the cost-selection path either.
  const kernel = world().unit("mighty-unit", { might: 5 }).build();
  const [mighty] = keywordDefinitionsById.get("Mighty").expand({ host: { canonicalCardId: CANONICAL } });
  assert.equal(mighty.effect.kind, "condition.value");
  assert.throws(
    () => binderFor(kernel).bindStatic(mighty, kernel.getObject("mighty-unit")),
    /Static ability kind condition\.value has no layer mapping/
  );
});

test.todo(
  "Invigorating Bloom: 'Exhaust a friendly [Mighty] unit' as a cost — blocked because CostSpec choices require exact " +
    "ObjectRefs (cost/plan-values.ts choiceObjects; body picks already have an ordered/zoneSlice path) and the filter vocabulary has no " +
    "current-Might>=5 predicate for CR 710; needs a filter-shaped object cost and a current-Might predicate in the " +
    "cost selector"
);

test.todo(
  "Invigorating Bloom: data issue (not changed) — the local catalog records printing rad-035-167 as cardType Unit with no " +
    "printed power and no printed Might while its text is unit-shaped; reported rather than fixed"
);

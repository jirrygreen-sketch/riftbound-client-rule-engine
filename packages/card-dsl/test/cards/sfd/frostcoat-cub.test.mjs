import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/frostcoat-cub.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { payCostPlan } from "../../../../engine-core/dist/cost/payment.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { evaluateCondition } from "../../../../engine-core/dist/effects/interpreter/condition.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { createEngineStaticBinder, staticCostSources } from "../../../../engine-core/dist/programs/statics.js";
import { translateCost } from "../../../../engine-core/dist/programs/play.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";

const CARD_ID = "card.hash-868962f51f93e867b6166a5b00e7da34767ced7692925eb143855d3d05c68618";

const [additionalCost, playTrigger] = program.abilities;
const [mightInstruction] = playTrigger.body;
const PAID_CONDITION = {
  kind: "result",
  result: "additional-cost-paid",
  id: "frostcoat-cub.additional-cost"
};

test("sfd-067-221 Frostcoat Cub: program validates, is registered and stays judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(cardProgramsById.get(CARD_ID), program);
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(
    program.sourceText,
    "You may pay :rb_rune_mind: as an additional cost to play me.\n" +
      "When you play me, if you paid the additional cost, give a unit -2 :rb_might: this turn."
  );
});

test("sfd-067-221 Frostcoat Cub: judgeReason names the cost, receipt and Might gaps", () => {
  assert.match(program.judgeReason, /356\.2\.b/);
  assert.match(program.judgeReason, /356\.4\.f\.1/);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /CostPlanInput/);
  assert.match(program.judgeReason, /result/);
  assert.match(program.judgeReason, /item\.payment/);
  assert.match(program.judgeReason, /MissingInformation/);
  assert.match(program.judgeReason, /cost\.additional has no layer mapping/);
  // RIFT-359 merged the result predicate and RIFT-261 merged the cost kinds, so
  // the reason must not keep citing the old "Condition shape has no source" or
  // "Play/Finalize wiring is entirely absent" framings.
  assert.doesNotMatch(program.judgeReason, /冻结 IR 没有费用结果绑定/);
  assert.doesNotMatch(program.judgeReason, /调研记为 condition\.result/);
  assert.doesNotMatch(program.judgeReason, /RIFT-89|RIFT-91|RIFT-257|RIFT-258|RIFT-261/);
  // The debuff must not be approximated with a Buff counter.
  assert.match(program.judgeReason, /702\/703/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("sfd-067-221 Frostcoat Cub: the optional additional cost is one Mind Power (CR 356.2.b)", () => {
  // 356.2.b/356.2.b.1: Optional Additional Cost imposed by a Passive Ability of
  // the card being played; the printed symbol :rb_rune_mind: is a named-domain
  // Power cost (135.2.e.4), never a generic Energy charge.
  assert.equal(additionalCost.kind, "static");
  assert.equal(additionalCost.effect.kind, "cost.additional");
  assert.equal(additionalCost.effect.id, "frostcoat-cub.additional-cost");
  assert.equal(additionalCost.effect.appliesTo, "self");
  assert.equal(additionalCost.effect.optional, true);
  assert.equal(additionalCost.effect.stage, "optional-additional");
  assert.equal(additionalCost.effect.payments.length, 1);
  const [payment] = additionalCost.effect.payments;
  assert.equal(payment.kind, "power");
  assert.deepEqual(payment.amount, { kind: "constant", value: 1 });
  assert.deepEqual(payment.allowedDomains, ["Mind"]);
});

test("sfd-067-221 Frostcoat Cub: the play trigger shape keeps the debuff as a continuous Might modification", () => {
  assert.equal(playTrigger.kind, "triggered");
  assert.equal(playTrigger.optional, false);
  assert.equal(playTrigger.trigger.at, "card-played");
  assert.deepEqual(playTrigger.trigger.filter, {
    event: "card-played",
    filter: { source: "self" }
  });
  // 383.2.a.1 + 356.4.f.1: "if you paid the additional cost" is part of the
  // trigger condition; the merged result predicate reads the finalized
  // { plan, receipt } pair.
  assert.deepEqual(playTrigger.trigger.condition, PAID_CONDITION);

  assert.equal(playTrigger.body.length, 1);
  assert.equal(mightInstruction.id, "frostcoat-cub.give-minus-2-might");
  assert.equal(mightInstruction.op, "continuous.might");
  assert.deepEqual(mightInstruction.args.amount, { kind: "constant", value: -2 });
  assert.deepEqual(mightInstruction.args.duration, { kind: "constant", value: "this-turn" });
  // Contract 3.6: the affected unit comes from the Finalize-locked TargetSpec;
  // the primitive's default selection would be the source.
  assert.deepEqual(mightInstruction.args.objects, {
    kind: "constant",
    value: { kind: "target", id: "frostcoat-cub.unit" }
  });
  assert.equal(mightInstruction.linkedTo, undefined);
  // The gate lives on the trigger condition; the instruction never carries an
  // invented always-true condition.
  assert.equal(mightInstruction.condition, undefined);

  // 355.9.b: "a unit" (no friend/foe qualifier) is a resolution-time choice of
  // one Board unit.
  assert.equal(mightInstruction.targets.length, 1);
  const [target] = mightInstruction.targets;
  assert.equal(target.id, "frostcoat-cub.unit");
  assert.deepEqual(target.filter, { type: "unit", zone: "board" });
  assert.equal(target.min, 1);
  assert.equal(target.max, 1);
  assert.equal(target.selection, "one");
});

test("sfd-067-221 Frostcoat Cub: the declared shapes name the cost and continuous-Might vocabulary", () => {
  // The program uses the cost-plan (cost.additional) and layers
  // (continuous.might) vocabulary rather than a merged stand-in: the debuff
  // must never be written as an effect.buff counter (702/703).
  assert.deepEqual(additionalCost.effect.kind, "cost.additional");
  assert.deepEqual(playTrigger.body.map((instruction) => instruction.op), ["continuous.might"]);
  assert.equal(playTrigger.body.some((instruction) => instruction.op === "effect.buff"), false);
});

test("sfd-067-221 Frostcoat Cub: the declaration enters the Finalize cost sources", () => {
  const kernel = world().unit("cub", { cardId: CARD_ID, might: 3 }).build();
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: () => { throw new Error("A static binding must not ask for a choice"); },
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint })
  });
  const engine = new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host });
  const handle = createEngineStaticBinder(engine).bindStatic(additionalCost, kernel.getObject("cub"));
  const [source] = staticCostSources(engine);
  assert.equal(source.ability.effect.kind, "cost.additional");
  assert.equal(source.ability.effect.optional, true);
  assert.deepEqual(source.ability.effect.payments, additionalCost.effect.payments);
  handle.unbind();
  assert.deepEqual(staticCostSources(engine), []);
});

test("sfd-067-221 Frostcoat Cub golden: the trigger condition reads the real paid/declined receipt (356.4.f.1)", () => {
  // The declaration is charged through the merged planner with a caller-supplied
  // component, exactly as a future CardProgram -> CostPlanInput consumer would;
  // the resulting { plan, receipt } pair is what the card's own condition reads.
  const kernel = world()
    .player("A", { energy: 5, power: ["Mind"] })
    .unit("cub", { energy: 3, power: null, controller: "A", owner: "A" })
    .build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("cub") });
  const planFor = (selected) => buildCostPlan(context, {
    id: "frostcoat-cub:play",
    cost: { kind: "printed" },
    optionalAdditional: [{
      id: "frostcoat-cub.additional-cost",
      kind: "additional",
      selected,
      cost: { payments: [{ kind: "power", amount: { kind: "constant", value: 1 }, allowedDomains: ["Mind"] }] }
    }]
  });
  const environment = (plan, receipt) => ({
    context: bindResolveContext(kernel, { source: kernel.getObject("cub"), controller: "A", cost: { plan, receipt } }),
    event: { timingPoint: "card-played" },
    cost: { plan, receipt },
    linked: (key) => kernel.linked(key),
    canLookBack: () => true,
    isIgnored: () => false
  });

  const paidPlan = planFor(true);
  const paidReceipt = payCostPlan(context.clone(), paidPlan);
  assert.deepEqual(paidPlan.selectedAdditional, [{ id: "frostcoat-cub.additional-cost", kind: "additional" }]);
  assert.deepEqual(paidReceipt.additional, [{ id: "frostcoat-cub.additional-cost", kind: "additional", paid: true }]);
  assert.equal(evaluateCondition(PAID_CONDITION, environment(paidPlan, paidReceipt)), true);

  // 356.4.f.1: declining is a false decision even though the base cost was paid.
  const declinedPlan = planFor(false);
  const declinedReceipt = payCostPlan(context.clone(), declinedPlan);
  assert.deepEqual(declinedPlan.declinedAdditional, ["frostcoat-cub.additional-cost"]);
  assert.equal(evaluateCondition(PAID_CONDITION, environment(declinedPlan, declinedReceipt)), false);

  // The real card-played wave carries no cost inputs yet (the gap recorded in
  // judgeReason), so the same condition cannot be evaluated there.
  const bare = bindResolveContext(kernel, { source: kernel.getObject("cub"), controller: "A" });
  assert.throws(
    () => evaluateCondition(PAID_CONDITION, {
      context: bare,
      event: { timingPoint: "card-played" },
      linked: (key) => kernel.linked(key),
      canLookBack: () => true,
      isIgnored: () => false
    }),
    /Unavailable condition result: additional-cost-paid/
  );
});

test("sfd-067-221 Frostcoat Cub golden: the gated debuff executes once the receipt is paid (356.4.f.1 + 143.2)", () => {
  // 383.4.a.2/420.4.a: with the trigger condition paid, the card's own body runs
  // through the production adapter and registers the arithmetic Might layer.
  const kernel = world().unit("target-unit", { owner: "B", controller: "B", might: 5 }).build();
  kernel.setTargets("frostcoat-cub.unit", [kernel.ref("target-unit")]);
  const bound = bindResolveContext(kernel, {
    source: kernel.getObject("target-unit"),
    controller: "A",
    cost: {
      plan: { selectedAdditional: [{ id: "frostcoat-cub.additional-cost", kind: "additional" }], declinedAdditional: [] },
      receipt: { paid: true, additional: [{ id: "frostcoat-cub.additional-cost", kind: "additional", paid: true }] }
    }
  });
  const outcome = resolveChainBody([mightInstruction], bound);
  assert.equal(outcome.status, "executed");
  assert.equal(kernel.continuousEffects.length, 1);
  assert.equal(kernel.continuousEffects[0].effect.effect.amount, -2);
});

test("sfd-067-221 Frostcoat Cub golden: the declared Mind Power cost is payable through the merged cost plan", () => {
  // 356.2.b/356.2.b.1: one printed :rb_rune_mind: Power. The merged plan pays
  // the component when the caller supplies it; Play/Finalize still lacks the
  // automatic optional-cost wiring.
  const kernel = world()
    .player("A", { energy: 5, power: ["Mind"] })
    .unit("cub", { energy: 3, power: null, controller: "A", owner: "A" })
    .build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("cub") });
  const plan = buildCostPlan(context, {
    id: "frostcoat-cub:play",
    cost: { kind: "printed" },
    mandatoryAdditional: [
      {
        id: "frostcoat-cub.additional-cost",
        cost: { payments: [{ kind: "power", amount: { kind: "constant", value: 1 }, allowedDomains: ["Mind"] }] }
      }
    ]
  });
  assert.equal(plan.total.energy, 3);
  assert.deepEqual(plan.total.power, [{ amount: 1, allowedDomains: ["Mind"] }]);
  const receipt = payCostPlan(context, plan);
  assert.equal(receipt.paid, true);
});

test("sfd-067-221 Frostcoat Cub golden: the card's own -2 Might instruction registers and expires", () => {
  const kernel = world()
    .unit("target-unit", { owner: "B", controller: "B", might: 5 })
    .build();
  kernel.setTargets("frostcoat-cub.unit", [kernel.ref("target-unit")]);

  const outcome = resolveChainBody([mightInstruction], kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(kernel.continuousEffects.length, 1);
  const [registration] = kernel.continuousEffects;
  assert.equal(registration.effect.layer, "arithmetic");
  assert.equal(registration.effect.effect.kind, "continuous.might");
  assert.equal(registration.effect.effect.amount, -2);
  assert.deepEqual(registration.duration, { type: "end-of-turn" });

  const layers = createLayerEngine(
    kernel.objects,
    kernel.continuousEffects.map((entry, index) => ({ ...entry, timestamp: index + 1 }))
  );
  assert.equal(layers.evaluate(kernel.ref("target-unit")).might, 3);
  assert.equal(layers.expireAt("turn-end").length, 1);
  assert.equal(layers.evaluate(kernel.ref("target-unit")).might, 5);
});

test("sfd-067-221 Frostcoat Cub golden: a stale buff target makes the instruction ignored", () => {
  const kernel = world().unit("target-unit", { owner: "B", controller: "B", might: 5 }).build();
  const stale = kernel.ref("target-unit");
  kernel.perform({ type: "kill", object: stale });
  kernel.setTargets("frostcoat-cub.unit", [stale]);

  const outcome = resolveChainBody([mightInstruction], kernel);
  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results[0].result, { status: "ignored", reason: "mistargeted" });
  assert.equal(kernel.continuousEffects.length, 0);
});

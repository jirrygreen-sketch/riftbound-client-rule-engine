import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/sky-splitter.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import costModify from "../../../../engine-core/dist/effects/instructions/cost.modify.js";
import { AwaitChoice } from "../../../../engine-core/dist/effects/contract.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import {
  bindResolveContext,
  createActionPipelineHost
} from "../../../../engine-core/dist/events/action-adapter.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { translateCost } from "../../../../engine-core/dist/programs/play.js";
import { finalizeCostPlan } from "../../../../engine-core/dist/cost/discounts/index.js";
import {
  finalizeTargetPlan,
  queryTargetCandidates
} from "../../../../engine-core/dist/target/target-plan.js";
import { resolveAll } from "../../../../engine-core/test/chain/helpers.mjs";

const [speed, costModifier, play] = program.abilities;
const damageInstruction = play.body[0];
const targetSpec = damageInstruction.targets[0];

function withSpell(builder, zone = "chain") {
  const initial = builder.object("sky-splitter", {
    cardId: program.canonicalCardId,
    types: ["spell"],
    zone,
    energy: 8,
    power: ["Fury"]
  }).build();
  return initial.clone({ sourceSnapshot: initial.getObject("sky-splitter") });
}

/**
 * Play the card through the production path: createProgramBinding.describePlay
 * builds the real ChainDraft from the program, ChainEngine finalizes it (target
 * locks + cost plan + payment through the merged cost system) and resolves the
 * frozen body. Nothing here hand-settles the card.
 */
function playSkySplitter({ energy = 20, might = 7 } = {}) {
  const kernel = world()
    .player("A", { energy, power: ["Fury"] })
    .player("B", { energy: 20 })
    .hand("sky-splitter", {
      cardId: program.canonicalCardId,
      types: ["spell"],
      energy: 8,
      power: ["Fury"]
    })
    .base("friendly-seven-might", { owner: "A", might })
    .unit("enemy-at-battlefield", { owner: "B", might: 4 })
    .build();
  const decide = request => {
    if (request.type === "select-objects") return request.options.slice(0, request.max ?? 1);
    throw new AwaitChoice(request);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: checkpoint => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: decide,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, {
      source, controller, timingPoint, choose: decide
    }),
    testTrigger: registration => kernel.test(registration.spec.condition)
  });
  const engine = new ChainEngine({
    turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false
  });
  // The registry refuses judge-required programs by design, so the binding is
  // built from an executable-status copy of the same IR for the chain to run.
  const binding = createProgramBinding({
    cardPrograms: [{ ...program, status: "executable", judgeReason: undefined }]
  });
  const source = kernel.getObject("sky-splitter");
  const draft = binding.describePlay({ type: "play", object: source.ref, player: "A" }, source);
  engine.execute(draft);
  // `execute` runs advance(): the spell is Finalized (targets locked, cost plan
  // frozen and paid) but not yet Resolved, so the frozen plan is still readable.
  const finalized = engine.items.at(-1);
  resolveAll(engine);
  return { kernel, engine, draft, finalized };
}

test("Sky Splitter program is valid EffectIR v2 data and judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.status, "judge-required");
  // The reason must name the real gaps measured against the merged sources:
  // no Finalize consumer for a card-declared static cost declaration, and no
  // collection-aggregate Expr for "the highest Might among units you control".
  assert.match(program.judgeReason, /buildCostPlan/);
  assert.match(program.judgeReason, /CostPlanInput\.discounts/);
  assert.match(program.judgeReason, /no layer mapping/);
  assert.match(program.judgeReason, /356\.4\.a\/356\.4\.d\/356\.4\.g/);
  assert.match(program.judgeReason, /聚合|aggregate/);
  assert.match(program.judgeReason, /arithmetic\.max/);
  assert.match(program.judgeReason, /Hand/);
});

test("Sky Splitter identity, status and sourceText match the printing", () => {
  assert.equal(
    program.canonicalCardId,
    "card.hash-94735882304ffe96826dd127aea87fdfaac6f979e3b075524de966b982a9c89f"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(
    program.sourceText,
    "[Action] (Play on your turn or in showdowns.)\n" +
      "This spell's Energy cost is reduced by the highest Might among units you control.\n" +
      "Deal 5 to a unit at a battlefield."
  );
});

test("Sky Splitter structure: [Action], a descriptive 356.4.d total-cost reduction, one 5-damage target", () => {
  assert.deepEqual(speed, { kind: "keyword", keyword: "action" });

  // "This spell's Energy cost is reduced by ..." is declared as the cost
  // modification shape (356.4.b) with a descriptive amount: neither the IR
  // Expr union nor the collector has an aggregate over a filtered collection
  // of current Might.
  assert.equal(costModifier.kind, "static");
  assert.equal(costModifier.effect.kind, "cost.modify");
  assert.equal(costModifier.effect.resource, "energy");
  assert.equal(costModifier.effect.appliesTo, "self");
  // 356.4.d: a discount on the total cost carries no component id; the merged
  // planner rejects an unknown component such as "total". The explicit stage
  // keeps an unsigned magnitude from being read as an increase.
  assert.equal(costModifier.effect.component, undefined);
  assert.equal(costModifier.effect.stage, "discount");
  assert.equal(costModifier.effect.amount.kind, "aggregate");
  assert.equal(costModifier.effect.amount.operator, "max");
  assert.equal(costModifier.effect.amount.property, "might");
  assert.deepEqual(costModifier.effect.amount.filter, {
    type: "unit",
    zone: "board",
    controller: "controller"
  });

  // The printed cost (8 Energy + 1 Fury power) is unchanged by the discount
  // (206 / 204.1); the discount only lowers the amount actually paid.
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 8 },
    power: { kind: "constant", value: 1 }
  });

  assert.deepEqual(
    play.body.map(instruction => [instruction.id, instruction.op]),
    [["sky-splitter.deal-5", "effect.damage"]]
  );
  assert.deepEqual(damageInstruction.args.amount, { kind: "constant", value: 5 });
  assert.deepEqual(damageInstruction.args.target, {
    kind: "constant",
    value: "sky-splitter.unit-at-battlefield"
  });
  assert.equal(damageInstruction.linkedTo, undefined);
  assert.equal(damageInstruction.targets.length, 1);
  assert.equal(targetSpec.id, "sky-splitter.unit-at-battlefield");
  assert.deepEqual(targetSpec.filter, { type: "unit", zone: "board" });
  assert.deepEqual(targetSpec.location, { type: "battlefield" });
  assert.equal(targetSpec.min, 1);
  assert.equal(targetSpec.max, 1);
  assert.equal(targetSpec.selection, "one");
});

test("Sky Splitter golden execution: the damage half deals exactly 5 to the locked unit", () => {
  // A 7-Might friendly unit is on the board, which is the 356.4.e example's
  // discount source; the damage clause itself does not depend on it.
  const kernel = withSpell(world()
    .unit("seven-might-unit", { owner: "A", might: 7 })
    .unit("enemy-at-battlefield", { owner: "B", might: 9 }));
  const plan = finalizeTargetPlan(kernel, targetSpec, {
    selected: [kernel.ref("enemy-at-battlefield")]
  });
  kernel.setTargets(targetSpec.id, plan.selected);

  const outcome = resolveChainBody(play.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(outcome.results[0].result.linkedValues.dealt, 5);
  assert.equal(outcome.results[0].result.linkedValues.dealtCount, 1);
  assert.deepEqual(outcome.results[0].result.linkedValues.dealtTo, [
    { target: kernel.ref("enemy-at-battlefield"), amount: 5 }
  ]);
  assert.deepEqual(outcome.events.map(event => event.action), ["damage"]);
  assert.equal(kernel.history({ action: "damage" }), 1);
  assert.equal(kernel.getObject("enemy-at-battlefield").damage, 5);
  assert.equal(kernel.getObject("seven-might-unit").damage, 0);
});

test("Sky Splitter golden execution: a stale target is ignored and the cost clause stays inert", () => {
  const kernel = withSpell(world()
    .player("A", { energy: 8, power: ["Fury"] })
    .unit("enemy-at-battlefield", { owner: "B", might: 9 })
    .unit("bystander", { owner: "B", might: 9 }));
  const stale = kernel.ref("enemy-at-battlefield");
  const plan = finalizeTargetPlan(kernel, targetSpec, { selected: [stale] });
  kernel.setTargets(targetSpec.id, plan.selected);
  kernel.perform({ type: "move-zone", object: stale, to: "hand" });

  const outcome = resolveChainBody(play.body, kernel);

  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results[0].result, { status: "ignored", reason: "mistargeted" });
  assert.deepEqual(outcome.events, []);
  assert.equal(kernel.history({ action: "damage" }), 0);
  assert.equal(kernel.getObject("enemy-at-battlefield").damage, 0);
  assert.equal(kernel.getObject("bystander").damage, 0);
  assert.equal(kernel.player("A").energy, 8);
  assert.deepEqual(kernel.player("A").power, ["Fury"]);
});

test("Sky Splitter damage can target a friendly unit at another battlefield but excludes Base and Gear", () => {
  const kernel = withSpell(world()
    .unit("ally", { owner: "A", might: 9, location: { type: "battlefield", id: "second-field" } })
    .unit("enemy", { owner: "B", might: 9 })
    .base("base-unit", { owner: "B", might: 9 })
    .object("gear", { owner: "B", types: ["gear"], zone: "board", location: { type: "battlefield", id: "second-field" } }));
  assert.deepEqual(queryTargetCandidates(kernel, targetSpec), [kernel.ref("ally"), kernel.ref("enemy")]);
  const plan = finalizeTargetPlan(kernel, targetSpec, { selected: [kernel.ref("ally")] });
  kernel.setTargets(targetSpec.id, plan.selected);

  const outcome = resolveChainBody(play.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.linkedValues.dealt, 5);
  assert.deepEqual(outcome.events.map(event => event.action), ["damage"]);
  assert.equal(kernel.getObject("ally").damage, 5);
  for (const id of ["enemy", "base-unit", "gear"]) assert.equal(kernel.getObject(id).damage, 0);
});

test("Sky Splitter damage rechecks battlefield location when the locked unit moves to Base", () => {
  const kernel = withSpell(world()
    .unit("leaving", { owner: "B", might: 9 })
    .unit("bystander", { owner: "B", might: 9 }));
  const locked = kernel.ref("leaving");
  const plan = finalizeTargetPlan(kernel, targetSpec, { selected: [locked] });
  kernel.setTargets(targetSpec.id, plan.selected);
  assert.equal(kernel.perform({ type: "move-location", object: locked, to: { type: "base", player: "B" } }).status, "done");
  assert.deepEqual(kernel.ref("leaving"), locked);

  const outcome = resolveChainBody(play.body, kernel);

  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results[0].result, { status: "ignored", reason: "mistargeted" });
  assert.deepEqual(outcome.events, []);
  assert.equal(kernel.getObject("leaving").damage, 0);
  assert.equal(kernel.getObject("bystander").damage, 0);
  assert.equal(kernel.history({ action: "damage" }), 0);
});

test("Sky Splitter current gap: Finalize fails closed on the unimplemented Might aggregate", () => {
  const kernel = withSpell(world()
    .player("A", { energy: 8, power: ["Fury"] })
    .unit("seven-might-unit", { owner: "A", might: 7 }), "hand");
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("sky-splitter") });

  assert.throws(
    () => finalizeCostPlan(
      context,
      { id: "sky-splitter.play", cost: { kind: "printed" } },
      {
        statics: [{ id: "sky-splitter.static", source: context.source.ref, ability: costModifier }]
      }
    ),
    error => error?.reason === "judge-required" && /aggregate|expression/.test(String(error?.message))
  );
});

test("Sky Splitter printed play cost and the whole body execute through the production ChainEngine", () => {
  const { kernel, engine, draft, finalized } = playSkySplitter();

  // The play draft is the production translation of the shipped program.
  assert.equal(draft.speed, "action");
  assert.deepEqual(draft.body.map(instruction => [instruction.id, instruction.op]), [
    ["sky-splitter.deal-5", "effect.damage"]
  ]);
  // Finalize locks the production target and freezes the printed plan (204.1 /
  // 206): 8 Energy and 1 Power restricted to Fury, with no discounts applied.
  assert.deepEqual(finalized.targetPlans.map(plan => [plan.requirement.id, plan.selected.map(ref => ref.id)]), [
    ["sky-splitter.unit-at-battlefield", ["enemy-at-battlefield"]]
  ]);
  assert.equal(finalized.costPlan.printed.energy, 8);
  assert.deepEqual(finalized.costPlan.printed.power, ["Fury"]);
  assert.equal(finalized.costPlan.total.energy, 8);
  assert.deepEqual(finalized.costPlan.total.power, [{ amount: 1, allowedDomains: ["Fury"] }]);
  assert.deepEqual(finalized.costPlan.discounts, []);
  assert.equal(finalized.payment.paid, true);
  // Finalize really charged the Energy through the merged payment pipeline.
  assert.equal(kernel.player("A").energy, 12);
  // Resolve deals exactly 5 to the locked battlefield unit and the spell leaves
  // the Chain to its owner's Trash.
  assert.equal(kernel.getObject("enemy-at-battlefield").damage, 5);
  assert.equal(kernel.getObject("friendly-seven-might").damage, 0);
  assert.equal(kernel.getObject("sky-splitter").zone, "trash");
  assert.deepEqual(engine.trace.filter(event => event.step === "finalized").length, 1);
  assert.deepEqual(engine.trace.filter(event => event.step === "resolved").length, 1);
});

test("Sky Splitter current gap: the printed cost is charged even with a 7-Might unit, because no Finalize consumer collects the card's own static discount", () => {
  // Evidence for gap (1): 356.4.a allows the card being played to discount its
  // own cost, but the production Finalize path plans only `item.cost`. A
  // 7-Might friendly unit therefore changes nothing observable.
  const { kernel } = playSkySplitter({ might: 7 });
  assert.equal(kernel.player("A").energy, 12);

  // The two spellings that would carry the declaration into Finalize are both
  // refused by the merged translator, so the discount cannot be authored there
  // either.
  assert.throws(
    () => translateCost({ kind: "printed", discount: { amount: 7 } }, "sky-splitter", "play"),
    /Unsupported play cost field discount/
  );
  for (const kind of ["additional", "additional-cost"]) {
    assert.throws(
      () => translateCost({ kind, payments: [] }, "sky-splitter", "play"),
      /Additional costs are not bound/
    );
  }
});

test("Sky Splitter current gap: the production static binder refuses to bind the cost declaration to the layer registry", () => {
  // Evidence for gap (1), second half: even the non-playing route (lifecycle
  // static binding) rejects the effect, so nothing reaches the layer registry.
  const kernel = world()
    .player("A", { energy: 8, power: ["Fury"] })
    .base("host", { owner: "A", might: 2 })
    .build();
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: checkpoint => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: () => { throw new Error("unexpected choose"); },
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint }),
    testTrigger: registration => kernel.test(registration.spec.condition)
  });
  const engine = new ChainEngine({
    turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false
  });
  const binder = createEngineStaticBinder(engine);

  assert.throws(
    () => binder.bindStatic(costModifier, kernel.getObject("host")),
    error => error?.code === "judge-required"
      && /cost\.modify has no layer mapping/.test(String(error?.message))
  );
  assert.deepEqual(engine.layers.registry.list(), []);
});

test("Sky Splitter current gap: the total-cost discount cannot use component \"total\", and the unsigned amount reads as an increase", () => {
  const kernel = withSpell(world()
    .player("A", { energy: 8, power: ["Fury"] })
    .unit("seven-might-unit", { owner: "A", might: 7 }), "hand");
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("sky-splitter") });
  const plan = effect => finalizeCostPlan(
    context,
    { id: "sky-splitter.play", cost: { kind: "printed" } },
    { statics: [{ id: "sky-splitter.static", source: context.source.ref, ability: { kind: "static", effect } }] }
  );
  const base = { kind: "cost.modify", resource: "energy", appliesTo: "self" };

  // 356.4.d: the shipped total-cost declaration carries an explicit stage and
  // no component id, because "total" is not a merged component id.
  assert.equal(costModifier.effect.component, undefined);
  assert.equal(costModifier.effect.stage, "discount");
  assert.throws(
    () => plan({
      ...base,
      stage: "discount",
      component: "total",
      amount: { kind: "constant", value: 7 }
    }),
    /Discount refers to an unknown cost component/
  );
  // A signed magnitude infers the stage; an unsigned one without a stage is an
  // increase, so the declaration must state `discount` explicitly whenever the
  // aggregate Expr eventually lands.
  const unsigned = plan({ ...base, amount: { kind: "constant", value: 7 } });
  assert.equal(unsigned.total.energy, 15);
  assert.deepEqual(unsigned.discounts, []);
  assert.deepEqual(
    unsigned.components.map(component => [component.id, component.stage, component.cost.energy]),
    [["base", "base", 8], ["sky-splitter.static:0:total", "increase", 7]]
  );
  const staged = plan({ ...base, stage: "discount", amount: { kind: "constant", value: 7 } });
  assert.equal(staged.total.energy, 1);
});

test("Sky Splitter supported cost-plan component: 356.4.e orders each discount's own minimum", () => {
  // Explicit caller-supplied numeric discounts exercise the merged planner,
  // not the still-missing card-static collector or highest-Might aggregate.
  for (const [discountOrder, expectedEnergy, expectedSteps] of [
    [["eager", "numeric-reduction"], 0, [["eager", 8, 7], ["numeric-reduction", 7, 0]]],
    [["numeric-reduction", "eager"], 1, [["numeric-reduction", 8, 1], ["eager", 1, 1]]]
  ]) {
    const kernel = withSpell(world().player("A", { energy: 8, power: ["Fury"] }), "hand");
    const run = runInstruction(costModify, {
      id: "sky-splitter.numeric-plan",
      cost: translateCost(play.cost, "sky-splitter.numeric-plan", "play"),
      domains: ["Fury"],
      modifiers: [
        { id: "eager", kind: "reduce", resource: "energy", amount: { kind: "constant", value: 1 }, minimum: { kind: "constant", value: 1 } },
        { id: "numeric-reduction", kind: "reduce", resource: "energy", amount: { kind: "constant", value: 7 } }
      ],
      discountOrder
    }, { world: kernel });

    assert.equal(run.result.status, "executed");
    assert.equal(run.linked.cost.total.energy, expectedEnergy);
    assert.deepEqual(run.linked.cost.discounts.map(discount => [discount.id, discount.before, discount.after]), expectedSteps);
    assert.deepEqual(run.linked.cost.total.power, [{ amount: 1, allowedDomains: ["Fury"] }]);
    assert.deepEqual(run.linked.cost.printed, { energy: 8, power: ["Fury"] });
    assert.equal(kernel.getObject("sky-splitter").energy, 8);
    assert.deepEqual(kernel.getObject("sky-splitter").power, ["Fury"]);
    assert.equal(kernel.player("A").energy, 8);
    assert.deepEqual(run.events, []);
  }
});

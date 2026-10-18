// Scenario execution evidence: ../../templates/static-642.test.mjs.
// This file keeps the validation and identity checks plus the key structural
// assertions; the real execution path for this card lives in that template row.
import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/starry-eyed-songstress.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import modify from "../../../../engine-core/dist/effects/instructions/cost.modify.js";
import { finalizeCostPlan } from "../../../../engine-core/dist/cost/discounts/index.js";
import { CostPlanError } from "../../../../engine-core/dist/cost/plan-types.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { bindStaticAbility, createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";

const CANONICAL_ID =
  "card.hash-464b0b2dffb63bc44ee6874ec88c809233d08e06f5215125cc0ac77d4012c215";
const SOURCE_TEXT =
  "As an additional cost to play a spell, you may exhaust me and three friendly units to reduce " +
  "the cost of that spell by :rb_energy_2:.";

const [ability] = program.abilities;
const { effect } = ability;

test("rad-151-167 Starry-Eyed Songstress: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("rad-151-167 Starry-Eyed Songstress: identity, status, judgeReason, and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /cost\.(additional|modify|pay)/);
  assert.match(program.judgeReason, /layerFor/);
  assert.match(program.judgeReason, /legend-zone/);
  // 2026-10-18 refresh: the merged collector is the other consumer candidate and
  // it refuses this declaration's additionalCost field.
  assert.match(program.judgeReason, /additionalCost/);
  assert.match(program.judgeReason, /board\/rune-zone/);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("rad-151-167 Starry-Eyed Songstress: passive ability is a spell-play cost modification", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "static");
  assert.equal(ability.condition, undefined);
  // CR 363: the provider is a Passive Ability; CR 356.4.f: the discount is a
  // fixed 2 Energy reduction of the spell being played.
  assert.equal(effect.kind, "cost.modify");
  assert.equal(effect.appliesTo, "play-spell-cost");
  assert.equal(effect.resource, "energy");
  assert.equal(effect.amount, -2);
  assert.deepEqual(effect.filter, { type: "spell", controller: "controller" });
});

test("rad-151-167 Starry-Eyed Songstress: optional additional cost is exhaust me plus three friendly units", () => {
  // CR 356.2.b.1: "as an additional cost" + "may" is an Optional Additional Cost.
  assert.equal(effect.additionalCost.optional, true);
  assert.equal(effect.additionalCost.payments.length, 2);

  // CR 415.4 / 415.5: "exhaust me" is a cost-Exhaust on the legend itself.
  const [exhaustMe, exhaustUnits] = effect.additionalCost.payments;
  assert.deepEqual(exhaustMe, { kind: "exhaust", object: "self" });

  // CR 355.10.c.1 / 355.7: cost selections are not targets, so this is a
  // non-target object choice (three friendly units, exactly three).
  assert.equal(exhaustUnits.kind, "exhaust");
  assert.equal(exhaustUnits.amount, 3);
  assert.equal(exhaustUnits.choice.id, "starry-eyed-songstress.friendly-units");
  assert.equal(exhaustUnits.choice.min, 3);
  assert.equal(exhaustUnits.choice.max, 3);
  assert.equal(exhaustUnits.choice.selection, "all");
  assert.equal(exhaustUnits.choice.zone, "board");
  assert.equal(exhaustUnits.choice.type, "unit");
  // "friendly units" = the legend controller's units.
  assert.equal(exhaustUnits.choice.owner, "controller");
});

test("rad-151-167 Starry-Eyed Songstress: cost.modify really prices the optional exhaust plus the 2-Energy discount", () => {
  // 356.2.b.1 / 356.4.c: the merged cost.modify primitive can already express
  // this card's story — an optional additional cost in step 2 plus a component
  // discount — and the real planner applies the discount only when the optional
  // cost was actually paid.
  const paidKernel = world().player("A", { energy: 5 })
    .unit("songstress", { zone: "board", exhausted: false })
    .unit("ally-1", {}).unit("ally-2", {}).unit("ally-3", {})
    .build()
    .clone({ sourceSnapshot: null });
  // The cost plan is built for the legendary source being played, so "exhaust me"
  // resolves through ctx.source exactly like the card's other cost references.
  const paidWorld = paidKernel.clone({ sourceSnapshot: paidKernel.getObject("songstress") });
  const args = {
    id: "starry-eyed-songstress.plan",
    cost: { kind: "explicit", energy: { kind: "constant", value: 5 } },
    optionalAdditional: [
      {
        id: "starry-eyed-songstress.exhaust-me",
        kind: "additional",
        cost: { payments: [{ kind: "exhaust", object: "self" }] }
      }
    ],
    modifier: { kind: "reduce", resource: "energy", amount: { kind: "constant", value: 2 } }
  };
  const paid = runInstruction(modify, args, { world: paidWorld, answers: { "starry-eyed-songstress.plan:optional:starry-eyed-songstress.exhaust-me": true } });
  assert.equal(paid.result.status, "executed");
  const paidPlan = paid.linked.cost;
  assert.equal(paidPlan.total.energy, 3, "5 Energy reduced by the paid additional cost's discount");
  assert.deepEqual(paidPlan.selectedAdditional, [{ id: "starry-eyed-songstress.exhaust-me", kind: "additional" }]);
  assert.deepEqual(paidPlan.discounts, [
    { id: "starry-eyed-songstress.plan:modifier:0", component: null, resource: "energy", amount: 2, minimum: 0, before: 5, after: 3 }
  ]);
  assert.deepEqual(
    paidPlan.total.actions.map(action => action.action),
    [{ type: "exhaust", object: paidWorld.ref("songstress") }],
    "the exhausted legend is part of the same finalized plan"
  );

  const declinedKernel = world().player("A", { energy: 5 }).unit("songstress", { zone: "board" }).build();
  const declinedWorld = declinedKernel.clone({ sourceSnapshot: declinedKernel.getObject("songstress") });
  const declined = runInstruction(modify, args, { world: declinedWorld, answers: { "starry-eyed-songstress.plan:optional:starry-eyed-songstress.exhaust-me": false } });
  const declinedPlan = declined.linked.cost;
  assert.deepEqual(declinedPlan.declinedAdditional, ["starry-eyed-songstress.exhaust-me"]);
  assert.equal(declinedPlan.total.energy, 3, "the primitive applies the discount as a caller-supplied modifier; the card-side gate is the gap");
});

test("rad-151-167 Starry-Eyed Songstress: the declared static still has no production consumer", () => {
  // The real static binder refuses this declaration twice over: staticTarget
  // rejects appliesTo "play-spell-cost", and the same effect with a bindable
  // appliesTo still fails because layerFor has no cost.modify mapping.
  const kernel = world().player("A").player("B").unit("songstress", { owner: "A", types: ["unit"] }).build();
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: checkpoint => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: request => { throw new Error("Unexpected choice: " + request.id); },
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint })
  });
  const engine = new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false });
  assert.throws(
    () => bindStaticAbility(createEngineStaticBinder(engine), ability, kernel.getObject("songstress")),
    /Unsupported static appliesTo "play-spell-cost"/
  );
  assert.throws(
    () => bindStaticAbility(createEngineStaticBinder(engine), { ...ability, effect: { ...ability.effect, appliesTo: "self" } }, kernel.getObject("songstress")),
    /Static ability kind cost\.modify has no layer mapping/
  );
});

test("rad-151-167 Starry-Eyed Songstress: the merged collector refuses the declared optional additional cost", () => {
  // The merged collector is the other candidate consumer for this declaration
  // kind. It rejects the card's `additionalCost` field outright, so the printed
  // optional cost cannot be installed from the program (356.2.b.1).
  const kernel = world()
    .player("A", { energy: 5 })
    .object("songstress", { types: ["legend"], zone: "board", location: { type: "base", player: "A" } })
    .hand("spell", { types: ["spell"], energy: 3, power: [] })
    .build();
  const ctx = kernel.clone({ sourceSnapshot: kernel.getObject("spell") });
  assert.throws(
    () => finalizeCostPlan(ctx, { id: "spell-play", cost: { kind: "printed" } }, {
      statics: [{ id: "songstress:0", source: ctx.ref("songstress"), ability }]
    }),
    error => error instanceof CostPlanError && error.reason === "judge-required" &&
      /Unsupported cost modification field additionalCost/.test(error.message)
  );

  // Rewriting the declaration into the collector's own vocabulary would drop the
  // printed additional cost entirely and discount unconditionally, so it is not a
  // faithful substitution; the measured result is recorded to keep that visible.
  const rewritten = { kind: "static", effect: { kind: "continuous.cost-modification", resource: "energy", amount: { kind: "constant", value: -2 }, appliesTo: "spell-play-cost" } };
  const plan = finalizeCostPlan(ctx, { id: "spell-play", cost: { kind: "printed" } }, {
    statics: [{ id: "songstress:0", source: ctx.ref("songstress"), ability: rewritten }]
  });
  assert.equal(plan.total.energy, 1, "an unconditional rewrite would discount without the printed exhaust cost");
  assert.equal(plan.total.actions.length, 0, "...and would pay none of the printed cost");
});

// The whole card stays blocked: cost.modify has no layer mapping in
// programs/statics.ts and no consumer reads the card's static cost declaration
// or the legend's additional cost; the contract ZoneId has no legend zone, so
// there is no honest execution scenario to run here.
test.todo(
  "rad-151-167 Starry-Eyed Songstress: offer the optional additional cost in the cost plan's " +
    "step 2 and apply the fixed -2 Energy discount only when it was paid (CR 356.2.b.1 / 356.4.f) — " +
    "cost.modify really prices that story, but no consumer reads the card's static declaration " +
    "(programs/statics.ts rejects cost.modify)"
);
test.todo(
  "rad-151-167 Starry-Eyed Songstress: exhaust the legend in the Legend Zone (CR 107.4.c / 415.4; " +
    "contract ZoneId needs legend-zone) after cost.modify gets a layer mapping and a cost-plan consumer"
);

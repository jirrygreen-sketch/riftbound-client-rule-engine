import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/sky-splitter.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import costModify from "../../../../engine-core/dist/effects/instructions/cost.modify.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { translateCost } from "../../../../engine-core/dist/programs/play.js";
import {
  finalizeTargetPlan,
  queryTargetCandidates
} from "../../../../engine-core/dist/target/target-plan.js";

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

test("Sky Splitter program is valid EffectIR v2 data and judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.status, "judge-required");
  // The reason must name the real gaps: no Finalize consumer for a card-declared
  // cost.modify and no max-aggregate expression.
  assert.match(program.judgeReason, /CostPlanInput\.discounts|Finalize|cost\.modify/);
  assert.match(program.judgeReason, /356\.4/);
  assert.match(program.judgeReason, /聚合|aggregate/);
  assert.match(program.judgeReason, /356\.4\.g/);
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

test("Sky Splitter structure: [Action], a descriptive cost reduction, one 5-damage target", () => {
  assert.deepEqual(speed, { kind: "keyword", keyword: "action" });

  // "This spell's Energy cost is reduced by ..." is declared as the cost
  // modification shape (356.4.b) with a descriptive amount: arithmetic.max
  // accepts explicit operands, not a filtered collection of current Might.
  assert.equal(costModifier.kind, "static");
  assert.equal(costModifier.effect.kind, "cost.modify");
  assert.equal(costModifier.effect.resource, "energy");
  assert.equal(costModifier.effect.component, "total");
  assert.equal(costModifier.effect.appliesTo, "self");
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

test.todo(
  "Sky Splitter: Finalize must collect the spell's static self-discount while " +
    "playing from Hand and evaluate a filtered maximum of current controlled " +
    "Board-unit Might (including Base) at 356.4.g; arithmetic.max only accepts " +
    "explicit operands, so aggregate metadata stays non-executable."
);

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

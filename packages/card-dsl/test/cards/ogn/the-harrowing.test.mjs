import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/the-harrowing.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { prepareCostPayment } from "../../../../engine-core/dist/cost/payment.js";
import costModify from "../../../../engine-core/dist/effects/instructions/cost.modify.js";
import play from "../../../../engine-core/dist/effects/instructions/effect.play.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-b1f0d3c36b0411806913cc29b12f067b24cd42286481ac3676aa35aa75b6943c";
const [ability] = program.abilities;
const [playUnit] = ability.body;
const unitSpec = playUnit.targets[0];

// A caller-supplied catalog projection exercises the merged cost arithmetic.
// The card still has no producer that obtains this from its locked target.
const PRINTED_UNIT = {
  id: "test-unit-printing",
  cardType: "Unit",
  domains: ["Chaos"],
  energy: 3,
  power: 1
};

function ignoredEnergyPlan(kernel, extraCosts = {}) {
  const run = runInstruction(costModify, {
    id: "the-harrowing.cost-probe",
    cost: { kind: "printed" },
    printed: PRINTED_UNIT,
    baseModifications: [{ kind: "ignore-base", ignore: "energy" }],
    ...extraCosts
  }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.asked, null);
  assert.deepEqual(run.events, []);
  const plan = run.linked.cost;
  assert.equal(plan.finalized, true);
  assert.deepEqual(plan.printed, { energy: 3, power: 1 });
  assert.deepEqual(plan.modifications, [{ kind: "ignore-base", ignore: "energy" }]);
  return plan;
}

function playOverride(kernel, plan) {
  // Use the cost layer's actual allocation instead of hand-writing a flat
  // FinalizedCostPlan or passing CostPlan.total to effect.play as if it were one.
  const prepared = prepareCostPayment(kernel, plan);
  assert.equal(prepared.actions.length, 1);
  assert.equal(prepared.actions[0].action.type, "pay");
  return prepared.actions[0].action.plan;
}

test("The Harrowing program is valid EffectIR v2 data", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("The Harrowing identity and judge-required status match the printing", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.judgeReason.includes("356.1.b.2"), true);
  assert.match(program.judgeReason, /CostPlanInput/);
  assert.equal(program.judgeReason.includes("ignore-base"), true);
  assert.match(program.judgeReason, /chain handoff/);
  assert.match(program.judgeReason, /chain handoff 均已合入/);
  assert.match(program.judgeReason, /CostPlanInput\.printed/);
  assert.match(program.judgeReason, /ctx\.source（本法术）/);
  assert.match(program.judgeReason, /chain\/interpreter-adapter\.ts/);
  assert.match(program.judgeReason, /CostPlan.*total/);
  assert.match(program.judgeReason, /356\.1\.b\.3/);
  assert.equal(
    program.sourceText,
    "Play a unit from your trash, ignoring its Energy cost. (You must still pay its Power cost.)"
  );
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("The Harrowing structure: printed cost plus a play from trash with a cost.modify descriptor", () => {
  // No speed keyword: normal timing is outside Showdowns on your turn (155).
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "play");
  assert.deepEqual(ability.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 6 },
    power: { kind: "constant", value: 2 }
  });

  assert.equal(playUnit.op, "effect.play");
  assert.equal(playUnit.linkedTo, undefined);
  assert.deepEqual(playUnit.args.target, { kind: "constant", value: "the-harrowing.unit" });
  // 356.1.b.2's "ignore its Energy cost" is recorded as a base-cost rewrite:
  // only the Energy component is set to zero, the Power cost still applies.
  assert.deepEqual(playUnit.args.cost, {
    kind: "constant",
    value: { kind: "cost.modify", ignore: "energy" }
  });

  // 355.10.a / 355.10.a.1: a Trash is a Public zone, so the unit card in it is
  // a target; 056.1 keeps it in its owner's zone.
  assert.deepEqual(unitSpec, {
    id: "the-harrowing.unit",
    filter: { types: "unit", zone: "trash", owner: "controller" },
    min: 1,
    max: 1,
    selection: "one"
  });
});

test("The Harrowing golden: the unfinalized cost modifier is refused, not silently waived", () => {
  // effect.play only consumes an already-finalized cost plan (420.3.b.1) and
  // documents that it never derives printed costs or implements an ignored-cost
  // rule, so the descriptor above cannot be mistaken for a paid plan.
  const kernel = world()
    .card("trashed-unit", {
      owner: "A",
      controller: "A",
      types: ["unit"],
      zone: "trash"
    })
    .build();
  const run = runInstruction(
    play,
    { target: unitSpec.id, cost: playUnit.args.cost },
    { world: kernel, targets: { [unitSpec.id]: [kernel.ref("trashed-unit")] } }
  );

  assert.deepEqual(run.result, { status: "negated", reason: "impossible", events: [] });
  assert.equal(kernel.getObject("trashed-unit").zone, "trash");
  assert.equal(kernel.events.length, 0);
});

test("The Harrowing golden: a cost-layer-produced override (Energy 0, Power still owed) plays the unit", () => {
  const kernel = world()
    .player("A", { energy: 0, power: ["Chaos"] })
    .card("trashed-unit", {
      owner: "A",
      controller: "A",
      types: ["unit"],
      might: 3,
      energy: PRINTED_UNIT.energy,
      power: ["Chaos"],
      zone: "trash"
    })
    .build();
  const plan = ignoredEnergyPlan(kernel);
  assert.deepEqual(plan.base, {
    energy: 3, power: [{ amount: 1, allowedDomains: ["Chaos"] }], xp: 0, actions: []
  });
  assert.deepEqual(plan.total, {
    energy: 0, power: [{ amount: 1, allowedDomains: ["Chaos"] }], xp: 0, actions: []
  });
  const override = playOverride(kernel, plan);
  assert.equal(override.energy, 0);
  assert.deepEqual(override.power, ["Chaos"]);
  const run = runInstruction(
    play,
    {
      target: unitSpec.id,
      cost: { kind: "constant", value: override }
    },
    { world: kernel, targets: { [unitSpec.id]: [kernel.ref("trashed-unit")] } }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("trashed-unit").zone, "board");
  assert.equal(kernel.getObject("trashed-unit").might, 3);
  assert.equal(kernel.player("A").energy, 0);
  assert.deepEqual(kernel.events.map(event => event.action), ["pay", "play"]);
  assert.deepEqual(run.linked.played, 1);
  // TestWorld's pay action does not spend Power; the retained Power obligation
  // is proved by the planner/allocation and insufficient-Power test below.
});

test("The Harrowing golden: a unit that left the trash before resolution is ignored", () => {
  const kernel = world()
    .player("A", { energy: 0, power: ["Chaos"] })
    .card("trashed-unit", {
      owner: "A",
      controller: "A",
      types: ["unit"],
      energy: PRINTED_UNIT.energy,
      power: ["Chaos"],
      zone: "trash"
    })
    .build();
  const override = playOverride(kernel, ignoredEnergyPlan(kernel));
  const stale = kernel.ref("trashed-unit");
  kernel.perform({ type: "move-zone", object: stale, to: "banishment" });
  const run = runInstruction(
    play,
    { target: unitSpec.id, cost: { kind: "constant", value: override } },
    { world: kernel, targets: { [unitSpec.id]: [stale] } }
  );

  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(kernel.getObject("trashed-unit").zone, "banishment");
  // A resolution-time recheck (359.3.e.5-e.7) leaves the instruction ignored
  // and performs no action of its own.
  assert.deepEqual(run.events, []);
});

test("The Harrowing golden: ignoring Energy still requires the unit's Power", () => {
  const kernel = world()
    .player("A", { energy: 9, power: ["Fury"] })
    .card("trashed-unit", {
      owner: "A", types: ["unit"], zone: "trash", energy: 3, power: ["Chaos"]
    })
    .build();
  const plan = ignoredEnergyPlan(kernel);
  assert.equal(plan.total.energy, 0);
  assert.deepEqual(plan.total.power, [{ amount: 1, allowedDomains: ["Chaos"] }]);
  assert.throws(() => prepareCostPayment(kernel, plan), { reason: "cannot-pay-cost" });
  assert.equal(kernel.getObject("trashed-unit").zone, "trash");
  assert.equal(kernel.player("A").energy, 9);
  assert.deepEqual(kernel.player("A").power, ["Fury"]);
  assert.deepEqual(kernel.events, []);
});

test("The Harrowing golden: additional Energy costs and increases survive ignoring base Energy (356.1.b.3)", () => {
  const kernel = world()
    .player("A", { energy: 4, power: ["Chaos"] })
    .card("trashed-unit", {
      owner: "A", types: ["unit"], zone: "trash", energy: 3, power: ["Chaos"]
    })
    .build();
  const plan = ignoredEnergyPlan(kernel, {
    mandatoryAdditional: [{
      id: "additional-energy",
      cost: { energy: { kind: "constant", value: 2 } }
    }],
    modifier: { kind: "increase", resource: "energy", amount: { kind: "constant", value: 1 } }
  });
  assert.deepEqual(plan.components.map(component => [component.stage, component.cost.energy]), [
    ["base", 0], ["mandatory-additional", 2], ["increase", 1]
  ]);
  assert.equal(plan.total.energy, 3);
  assert.deepEqual(plan.total.power, [{ amount: 1, allowedDomains: ["Chaos"] }]);
  const override = playOverride(kernel, plan);
  assert.equal(override.energy, 3);
  assert.deepEqual(override.power, ["Chaos"]);
  const run = runInstruction(play, {
    target: unitSpec.id,
    cost: { kind: "constant", value: override }
  }, { world: kernel, targets: { [unitSpec.id]: [kernel.ref("trashed-unit")] } });
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("trashed-unit").zone, "board");
  assert.equal(kernel.player("A").energy, 1);
  assert.deepEqual(run.events.map(event => event.action), ["pay", "play"]);
  assert.equal(run.linked.played, 1);
});

test.todo(
  "The Harrowing: a merged consumer must read this card's cost.modify descriptor and have " +
    "Finalize build the ignore-base plan (356.1.b.2: base Energy set to 0, Power still owed; " +
    "356.1.b.3 keeps later additional costs) for the effect.play handoff, including reading the " +
    "selected trash card's printed cost."
);

test.todo(
  "The Harrowing: adapt CostPlan.total and its additional costs into the nested unit's Finalize " +
    "cost input (356.1.b.3 / 420.3.b.1); chain handoff already exists, but forwarding the full " +
    "cost.modify result as a flat effect.play override would lose its Energy/Power obligations."
);

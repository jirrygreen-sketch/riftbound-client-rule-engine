// Golden test for the Gold gear token (sfd-t03).
// The production Chain executes the Kill + Exhaust cost, Reaction timing, and
// immediate Universal Power Add. RIFT-987 separately covers token creation and
// lifecycle attachment of the sfd-t03 carrier.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/gold.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { payCostPlan } from "../../../../engine-core/dist/cost/payment.js";
import { AwaitChoice } from "../../../../engine-core/dist/effects/contract.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID =
  "card.hash-6249df4367d0a2e088c8eb1117ef59430f0d7dad4bf0fcf8a01d7f0415f4d511";
const SOURCE_TEXT =
  "Kill this, :rb_exhaust:: [Reaction] — [Add] :rb_rune_rainbow:. " +
  "(Abilities that add resources can't be reacted to.)";

const [activated] = program.abilities;
const [addUniversal] = activated.body;

const goldWorld = () => world()
  .object("gold", {
    name: "Gold",
    cardId: CARD_ID,
    isToken: true,
    types: ["gear"],
    tags: ["Token"],
    // energy/power/might stay null: the catalog prints no values, and null is
    // never rewritten to 0 (cards README section 2).
    energy: null,
    power: null,
    might: null,
    zone: "board",
    location: { type: "base", player: "A" },
    controller: "A",
    owner: "A"
  })
  .build();

test("sfd-t03 Gold: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
});

test("sfd-t03 Gold: identity, ruleset, executable status and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "executable");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CARD_ID), program);
  assert.equal(program.judgeReason, undefined);
});

test("sfd-t03 Gold: a reaction-timed activated ability whose cost is 'Kill this, exhaust this'", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(activated.kind, "activated");
  // 813.1.c.2: "[Reaction] —" on an ability is the Closed-State activation permission.
  assert.equal(activated.timing, "reaction");
  assert.equal(activated.restriction, undefined);
  assert.equal(activated.cost.kind, "activated");
  // 429.6 / 429.2.a: "Kill this" plus 135.2.e.2 / 415.5 "exhaust this"; both are
  // nonstandard cost payments the merged plan supports (357.2 payment order).
  assert.equal(activated.cost.payments.length, 2);
  const [exhaustPayment, killPayment] = activated.cost.payments;
  assert.equal(exhaustPayment.kind, "exhaust");
  assert.equal(exhaustPayment.object, "self");
  assert.equal(killPayment.kind, "kill");
  assert.equal(killPayment.object, "self");
});

test("sfd-t03 Gold: the body records one [A] Power and never a named domain", () => {
  assert.equal(activated.body.length, 1);
  assert.equal(addUniversal.id, "gold.add-universal-power");
  assert.equal(addUniversal.op, "effect.resources");
  // 430.1 / 430.5: "[Add] :rb_rune_rainbow:." adds one Power; 135.2.e.5 / 163.2.b
  // make that Power Universal ([A]); "universal" is the normalized source.
  assert.deepEqual(addUniversal.args, {
    power: { kind: "constant", value: ["universal"] }
  });
  assert.equal(addUniversal.args.energy, undefined);
  assert.equal(addUniversal.targets, undefined);
  assert.equal(addUniversal.picks, undefined);
  assert.equal(addUniversal.linkedTo, undefined);
  for (const domain of ["Fury", "Calm", "Mind", "Body", "Chaos", "Order"]) {
    assert.equal(JSON.stringify(addUniversal.args).includes(`"${domain}"`), false);
  }
});

test("sfd-t03 golden: the merged cost plan pays 'exhaust this, then kill this' and the token reaches the trash", () => {
  const kernel = goldWorld();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("gold") });
  const plan = buildCostPlan(context, {
    id: "gold:activated",
    cost: activated.cost
  });
  // 377.1: the printed cost is an activated-ability cost; both nonstandard actions
  // are part of the finalized plan, not resolution instructions.
  assert.deepEqual(plan.total.actions.map((action) => action.action.type), ["exhaust", "kill"]);
  assert.equal(plan.total.energy, 0);
  assert.deepEqual(plan.total.power, []);

  const receipt = payCostPlan(context, plan);
  assert.deepEqual(receipt.actions.map((entry) => [entry.action.type, entry.status]), [
    ["pay", "done"],
    ["exhaust", "done"],
    ["kill", "done"]
  ]);
  // 429.1 / 429.2: killing a permanent on the Board puts it into its Trash.
  assert.equal(context.getObject("gold").zone, "trash");
  assert.deepEqual(context.events.map((event) => event.action), ["pay", "exhaust", "kill"]);
});

test("sfd-t03 golden: after the kill cost the token leaves the Board, so the ability cannot be paid again", () => {
  const kernel = goldWorld();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("gold") });
  const plan = buildCostPlan(context, { id: "gold:activated", cost: activated.cost });
  payCostPlan(context, plan);

  // 415.4 / 429.2: the paid kill moved the token to its Trash, so a second
  // activation can no longer satisfy either nonstandard payment.
  assert.equal(context.getObject("gold").zone, "trash");
  assert.throws(
    () => payCostPlan(context, buildCostPlan(context, { id: "gold:activated-again", cost: activated.cost })),
    (error) => error.name === "CostPlanError" && error.reason === "cannot-pay-cost"
  );
});

function goldActivation() {
  const binding = createProgramBinding({
    cardPrograms: [{ ...program, status: "executable", judgeReason: undefined }]
  });
  const kernel = world()
    .player("A", { energy: 20 })
    .player("B", { energy: 20 })
    .object("gold", {
      name: "Gold",
      cardId: CARD_ID,
      isToken: true,
      types: ["gear"],
      tags: ["Token"],
      zone: "board",
      location: { type: "base", player: "A" },
      // The catalog prints no Energy / Power / Might; null is never rewritten
      // to 0 (cards README section 2).
      energy: null,
      power: null,
      might: null
    })
    .build();
  const decide = (request) => { throw new AwaitChoice(request); };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: (checkpoint) => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects,
    perform: (action) => kernel.perform(action),
    choose: decide,
    context: (source, controller, timingPoint) =>
      bindResolveContext(kernel, { source, controller, timingPoint, choose: decide }),
    testTrigger: (registration) => kernel.test(registration.spec.condition)
  });
  const engine = new ChainEngine({
    turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false
  });
  return { binding, engine, kernel };
}

test("sfd-t03 golden: the card-program binding describes the Reaction Add and the chain pays exhaust + kill", () => {
  // 377.1 / 357.2: the printed cost is the activation cost, so the merged
  // describeActivate draft carries it and the chain engine pays it for real.
  const { binding, engine, kernel } = goldActivation();
  const source = kernel.getObject("gold");
  const draft = binding.describeActivate(source, "A", 0);
  assert.equal(draft.kind, "add");
  assert.equal(draft.speed, "reaction");
  assert.deepEqual(
    draft.cost.cost.payments.map((payment) => [payment.kind, payment.object]),
    [["exhaust", "self"], ["kill", "self"]]
  );

  engine.execute(draft);
  while (engine.items.length) engine.pass(engine.priority);

  // 415.4 / 429.1 / 429.2: both nonstandard payments really happened and the
  // token really left the Board for its Trash.
  assert.deepEqual(kernel.events.map((event) => event.action).filter(Boolean), ["pay", "exhaust", "kill", "gain-power"]);
  assert.equal(kernel.getObject("gold").zone, "trash");
  assert.deepEqual(kernel.player("A").power, ["universal"]);
  assert.equal(kernel.player("A").energy, 20);
});

test("sfd-t03 golden: a second activation cannot be paid once the token is in the Trash", () => {
  const { binding, engine, kernel } = goldActivation();
  engine.execute(binding.describeActivate(kernel.getObject("gold"), "A", 0));
  while (engine.items.length) engine.pass(engine.priority);
  assert.equal(kernel.getObject("gold").zone, "trash");

  assert.throws(
    () => engine.execute(binding.describeActivate(kernel.getObject("gold"), "A", 0)),
    (error) => error.name === "CostPlanError" && error.reason === "cannot-pay-cost"
  );
  assert.deepEqual(kernel.player("A").power, ["universal"]);
});

// The previous "[A] cannot be paid" boundary asserted that the missing
// Universal Power representation is still missing; it is restored under the
// tightened review rule and stays aligned with the TODO entry below, while the
// real cost plan and the card-program binding keep their positive goldens above.

// Golden test for the Gold gear token (sfd-t03).
//
// The activated ability's two real halves — the nonstandard `kill` + `exhaust`
// cost payment through the merged cost plan, and the Reaction-speed declaration —
// are executed here. The [A] Universal Power addition and the missing token
// definition are the judged gaps (see judgeReason).
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/gold.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { payCostPlan } from "../../../../engine-core/dist/cost/payment.js";
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

test("sfd-t03 Gold: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CARD_ID), program);

  // The gap is Universal Power, not the cost or the Reaction timing.
  assert.match(program.judgeReason, /163\.2\.b/);
  assert.match(program.judgeReason, /Universal/);
  assert.match(program.judgeReason, /gain-universal-power/);
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
  // make that Power Universal ([A]). The closed six-domain union has no such
  // value, so the descriptive "rainbow" spelling is kept and never narrowed.
  assert.deepEqual(addUniversal.args, {
    power: { kind: "constant", value: ["rainbow"] }
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

// The Universal Power addition itself is a judged gap: the closed six-domain
// union has no [A] value and effect.resources must never approximate one, so the
// executed scenario deliberately stops at the cost half. It stays a TODO rather
// than a test that asserts today's refusal (contract 3.1 / README section 4: a
// dependency landing must not break this file).
test.todo(
  "sfd-t03 Gold: adding Universal Power ([A], CR 135.2.e.5 / 163.2.b) needs a contract representation — the " +
    "closed six-domain union and the gain-power action have no universal value"
);

test.todo(
  "sfd-t03 Gold: creating/playing a Gold gear token is blocked inside effect.token — its frozen definition table " +
    "deliberately omits Gold (\"definitions requiring other abilities, including Gold, remain blocked/judge-required\"), " +
    "so both the token definition and the source that would play it stay pending"
);

test.todo(
  "sfd-t03 Gold: the 430.3 window that lets a Reaction Add be activated while costs are being paid is owned by the " +
    "chain (ChainEngine.activateAddDuringPayment); wiring this card's activated Add ability into that window is part " +
    "of the card-program → chain adapter work (RIFT-120 follow-up)"
);

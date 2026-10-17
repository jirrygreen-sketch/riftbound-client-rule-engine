import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import program from "../../../dist/cards/sfd/ancient-henge.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { payCostPlan } from "../../../../engine-core/dist/cost/payment.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-d07e48aa4c135d7523968d576a0ed10afd4b5574804fc3baa31b2d60b20f46a3";
const SOURCE_TEXT =
  ":rb_exhaust:: [Reaction] — Pay any amount of Energy to [Add] that much :rb_rune_rainbow:. " +
  "(Abilities that add resources can't be reacted to.)";

const [ability] = program.abilities;

test("sfd-117-221 Ancient Henge: program validates and is registered by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-117-221 Ancient Henge: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /204\.3/);
  assert.match(program.judgeReason, /163\.2\.b/);
  assert.match(program.judgeReason, /430\.2/);
  assert.match(program.judgeReason, /RIFT-261/);
  assert.match(program.judgeReason, /RIFT-257/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("sfd-117-221 Ancient Henge: Reaction activated ability with the printed Exhaust cost and the pay-any/Add body", () => {
  assert.equal(program.abilities.length, 1);
  assert.deepEqual(ability.kind, "activated");
  // 813.1.c.2/813.1.d: [Reaction] on an ability is the Closed-State activation
  // permission, declared directly on the activated ability.
  assert.equal(ability.timing, "reaction");
  // 404.1.a/415.5: :rb_exhaust: before the dash is "Exhaust this".
  assert.deepEqual(ability.cost, {
    kind: "activated",
    payments: [{ kind: "exhaust", object: "self" }]
  });

  assert.equal(ability.body.length, 2);
  const [payAny, addThatMuch] = ability.body;
  // 204.3/204.3.a: the resolve-time "pay any amount" cost, whose paid amount
  // feeds the Add below.
  assert.equal(payAny.id, "ancient-henge.pay-any-energy");
  assert.equal(payAny.op, "cost.pay-any");
  assert.equal(payAny.linkedTo, undefined);
  assert.equal(payAny.targets, undefined);
  assert.equal(payAny.picks, undefined);
  // "[Add] that much [A]": a repeat reading the paid amount, each iteration
  // adding one Universal Power (135.2.e.5/163.2.b).
  assert.equal(addThatMuch.id, "ancient-henge.add-that-much");
  assert.equal(addThatMuch.op, "repeat");
  assert.equal(addThatMuch.linkedTo, payAny.id);
  assert.deepEqual(addThatMuch.args.count, {
    kind: "linked-value",
    instructionId: payAny.id,
    key: "paid"
  });
  const [addOne] = addThatMuch.args.body.value;
  assert.equal(addOne.id, "ancient-henge.add-one-universal-power");
  assert.equal(addOne.op, "effect.resources");
  assert.deepEqual(addOne.args.power, { kind: "constant", value: ["rainbow"] });
  assert.equal(addOne.args.energy, undefined);
});

test("sfd-117-221 Ancient Henge: the printed Exhaust cost is payable under the merged cost pipeline", () => {
  const kernel = world()
    .unit("ancient-henge", {
      types: ["gear"],
      might: null,
      zone: "board",
      location: { type: "base", player: "A" }
    })
    .build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("ancient-henge") });
  const plan = buildCostPlan(context, { id: "ancient-henge", cost: ability.cost });
  const receipt = payCostPlan(context, plan);

  assert.equal(receipt.paid, true);
  assert.equal(receipt.total.energy, 0);
  assert.equal(context.object(context.ref("ancient-henge")).exhausted, true);
  assert.deepEqual(receipt.actions.map((entry) => entry.action.type), ["pay", "exhaust"]);
});

test.todo(
  "sfd-117-221 Ancient Henge: \"Pay any amount of Energy to [Add] that much [A]\" (CR 204.3/204.3.a, whose printed example is this card) needs a " +
    "resolve-time player-chosen payment primitive that publishes the actually paid amount (cost.pay-any is not registered), bound to the Add via the body link."
);
test.todo(
  "sfd-117-221 Ancient Henge: [A] Universal Power (CR 135.2.e.5/163.2.b) is not representable in the closed six-domain Domain union; " +
    "effect.resources documents that it must never be approximated by a chosen domain."
);
test.todo(
  "sfd-117-221 Ancient Henge: the merged 'add' chain kind (chain/engine.ts advance/activateAddDuringPayment, 430.2/430.3) must be reachable " +
    "from this card program's activated ability — no CardProgram -> chain binding registers it (RIFT-257)."
);

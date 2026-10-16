import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/brazen-buccaneer.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";

const CARD_ID = "card.hash-da18079d11afce4cad1d799fd51de5b0219e0635613cd5a5b4a5f38e1a42aafc";

test("brazen-buccaneer: passes validateCardProgram and is indexed by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.equal(cardProgramsById.get(CARD_ID), program);
});

test("brazen-buccaneer: identity, ruleset, status and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /cost\.additional/);
  assert.match(program.judgeReason, /cost\.modify/);
  assert.match(program.judgeReason, /356\.2\.b\.1/);
  assert.match(program.judgeReason, /RIFT-9/);
  assert.equal(
    program.sourceText,
    "As you play me, you may discard 1 as an additional cost. If you do, reduce my cost by :rb_energy_2:."
  );
});

test("brazen-buccaneer: the additional-cost and discount halves are two static declarations", () => {
  assert.equal(program.abilities.length, 2);
  for (const ability of program.abilities) {
    assert.equal(ability.kind, "static");
    assert.equal(ability.effect.appliesTo, "self");
    assert.equal(ability.condition, undefined);
  }
  assert.equal(program.abilities[0].effect.kind, "cost.additional");
  assert.equal(program.abilities[1].effect.kind, "cost.modify");
});

test("brazen-buccaneer: optional additional cost is one discarded hand card (356.2.b.1)", () => {
  const [ability] = program.abilities;
  const effect = ability.effect;
  assert.equal(effect.optional, true);
  assert.equal(effect.stage, "optional-additional");
  assert.equal(effect.id, "brazen-buccaneer.discard-cost");
  assert.equal(effect.payments.length, 1);
  const [payment] = effect.payments;
  assert.equal(payment.kind, "discard");
  assert.deepEqual(payment.amount, { kind: "constant", value: 1 });
  // 355.10.c: the discarded card is a non-target cost choice, declared as a PickSpec.
  assert.deepEqual(payment.choice, {
    id: "brazen-buccaneer.discard",
    options: ["card-in-controller-hand"],
    min: 1,
    max: 1,
    selection: "one"
  });
});

test("brazen-buccaneer: the granted discount is 2 Energy and is bound to the paid additional cost (356.4/356.4.f.1)", () => {
  const discount = program.abilities[1].effect;
  assert.equal(discount.resource, "energy");
  // amount is the reduction (same meaning as RIFT-89 CostDiscount.amount), not
  // a signed delta; the printed cost is 6 and paying the cost reduces it by 2.
  assert.deepEqual(discount.amount, { kind: "constant", value: 2 });
  assert.equal(discount.stage, "discount");
  // 356.4.f.1: paying the decision is what grants the reduction, so it is
  // scoped to that additional-cost component rather than applied unconditionally.
  assert.equal(discount.grantedBy, program.abilities[0].effect.id);
  assert.equal(discount.minimum, undefined);
});

test.todo(
  "brazen-buccaneer: cost.additional / cost.modify primitives and the CardProgram -> CostPlan wiring " +
    "(optionalAdditional 356.2.b.1, discount 356.4, paid proof 356.4.f.1) are RIFT-9 / RIFT-89 work"
);
test.todo(
  "brazen-buccaneer: paying the additional cost applies the 2-Energy discount to the total cost " +
    "(requires the merged buildCostPlan to consume the card program, RIFT-89)"
);

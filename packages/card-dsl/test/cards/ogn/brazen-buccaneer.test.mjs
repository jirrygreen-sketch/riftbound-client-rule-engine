// Golden test for Brazen Buccaneer (ogn-002-298).
//
// Execution evidence (the real play through the printed 6 Energy cost, the
// unpayable-cost boundary and the fail-closed static cost bind) lives in the
// RIFT-675 parameterized template golden:
// test/cards/templates/static-static-675.test.mjs.
// This file keeps validation, identity, verbatim text, declared status and the
// key structure of the two static cost declarations.
import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/brazen-buccaneer.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";

const CARD_ID = "card.hash-da18079d11afce4cad1d799fd51de5b0219e0635613cd5a5b4a5f38e1a42aafc";
test("ogn-002-298 Brazen Buccaneer: passes validateCardProgram and is indexed by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(cardProgramsById.get(CARD_ID), program);
});

test("ogn-002-298 Brazen Buccaneer: identity, ruleset, status and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /356\.2\.b\.1/);
  assert.match(program.judgeReason, /CostPlan|Finalize/);
  assert.match(program.judgeReason, /paid-proof/);
  assert.match(program.judgeReason, /grantedBy.*selectedAdditional/);
  assert.match(program.judgeReason, /card-in-controller-hand/);
  assert.equal(
    program.sourceText,
    "As you play me, you may discard 1 as an additional cost. If you do, reduce my cost by :rb_energy_2:."
  );
  assert.deepEqual(JSON.parse(JSON.stringify(program)), program);
});

test("ogn-002-298 Brazen Buccaneer: the additional-cost and discount halves are two static declarations", () => {
  assert.equal(program.abilities.length, 2);
  for (const ability of program.abilities) {
    assert.equal(ability.kind, "static");
    assert.equal(ability.effect.appliesTo, "self");
    assert.equal(ability.condition, undefined);
  }
  assert.equal(program.abilities[0].effect.kind, "cost.additional");
  assert.equal(program.abilities[1].effect.kind, "cost.modify");
});

test("ogn-002-298 Brazen Buccaneer: optional additional cost is one discarded hand card (356.2.b.1)", () => {
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

test("ogn-002-298 Brazen Buccaneer: the granted discount is 2 Energy and is bound to the paid additional cost (356.4/356.4.f.1)", () => {
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

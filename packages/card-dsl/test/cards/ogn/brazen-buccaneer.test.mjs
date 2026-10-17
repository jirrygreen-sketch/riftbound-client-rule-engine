// RIFT-651 template execution evidence (pending the card-side CostPlan/Finalize
// adapter): packages/card-dsl/test/cards/templates/static-static-651.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/brazen-buccaneer.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { payCostPlan } from "../../../../engine-core/dist/cost/payment.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-da18079d11afce4cad1d799fd51de5b0219e0635613cd5a5b4a5f38e1a42aafc";
const literal = (value) => ({ kind: "constant", value });

test("brazen-buccaneer: passes validateCardProgram and is indexed by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.equal(cardProgramsById.get(CARD_ID), program);
});

test("brazen-buccaneer: identity, ruleset, status and verbatim sourceText", () => {
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

test("brazen-buccaneer golden: paying the discard reduces the 6-Energy cost to 4 (356.2.b.1/356.4)", () => {
  const [costAbility, discountAbility] = program.abilities;
  const base = world()
    .player("A", { energy: 20 })
    .hand("brazen-buccaneer", { types: ["unit"], energy: 6, power: ["Fury"] })
    .hand("fodder", { types: ["unit"] })
    .build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("brazen-buccaneer") });
  kernel.setPicks("brazen-buccaneer.discard", [kernel.ref("fodder")]);

  // The card's PickSpec options are the descriptive "card-in-controller-hand";
  // resolving that string into the controller's actual hand refs is part of
  // the missing CardProgram -> CostPlan binding (README §3 keeps
  // runtime refs out of static IR), so the golden test supplies the resolved
  // option set the plan consumes.
  const payments = costAbility.effect.payments.map((payment) => ({
    ...payment,
    choice: { ...payment.choice, options: [kernel.ref("fodder")] }
  }));

  const plan = buildCostPlan(kernel, {
    id: "play:brazen-buccaneer",
    cost: { kind: "explicit", energy: literal(6) },
    domains: ["Fury"],
    optionalAdditional: [
      {
        id: costAbility.effect.id,
        kind: "additional",
        selected: true,
        cost: { payments }
      }
    ],
    discounts: [
      {
        id: "brazen-buccaneer.discount",
        // 356.4: "reduce my cost by [2]" is a total-cost reduction. The merged
        // plan applies a component-less discount to the combined total; the
        // 356.4.f.1 paid-proof gate that would drop it on decline is the
        // missing piece named in judgeReason (the paid-proof binding).
        resource: discountAbility.effect.resource,
        amount: discountAbility.effect.amount
      }
    ]
  });

  assert.deepEqual(plan.selectedAdditional.map((entry) => entry.id), [costAbility.effect.id]);
  assert.deepEqual(plan.declinedAdditional, []);
  assert.equal(plan.total.energy, 4);
  const receipt = payCostPlan(kernel, plan);
  assert.equal(receipt.paid, true);
  assert.equal(kernel.getObject("fodder").zone, "trash");
  assert.equal(kernel.player("A").energy, 16);
});

test("brazen-buccaneer golden: declining the discard keeps the full printed cost", () => {
  const [costAbility] = program.abilities;
  const base = world()
    .player("A", { energy: 20 })
    .hand("brazen-buccaneer", { types: ["unit"], energy: 6, power: ["Fury"] })
    .hand("fodder", { types: ["unit"] })
    .build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("brazen-buccaneer") });

  // No discount is supplied: with the optional cost declined there is no paid
  // proof to grant it, and the merged plan has no way to gate on that proof.
  const plan = buildCostPlan(kernel, {
    id: "play:brazen-buccaneer",
    cost: { kind: "explicit", energy: literal(6) },
    domains: ["Fury"],
    optionalAdditional: [
      { id: costAbility.effect.id, kind: "additional", selected: false, cost: { payments: costAbility.effect.payments } }
    ]
  });

  assert.deepEqual(plan.selectedAdditional, []);
  assert.deepEqual(plan.declinedAdditional, [costAbility.effect.id]);
  assert.equal(plan.total.energy, 6);
  const receipt = payCostPlan(kernel, plan);
  assert.equal(receipt.paid, true);
  assert.equal(kernel.getObject("fodder").zone, "hand");
  assert.equal(kernel.player("A").energy, 14);
});

test.todo(
  "brazen-buccaneer: bind the static cost.additional / cost.modify declarations to the play cost plan " +
    "including the 356.4.f.1 paid-proof gate that applies the 2-Energy discount only when the " +
    "optional additional cost is selected; the card-facing cost declarations still need a Finalize adapter."
);

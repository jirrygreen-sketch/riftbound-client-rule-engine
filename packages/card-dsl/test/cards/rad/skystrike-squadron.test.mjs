import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/skystrike-squadron.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/index.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import deflect from "../../../../engine-core/dist/effects/keywords/Deflect.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";

const CARD_ID =
  "card.hash-0637f5fadf7db883948eb6366a512392aa80676b5a0ff45433e37f75c35961c3";

const [play, deflectKeyword] = program.abilities;
const [returnedGear] = play.cost.payments;
const [discount] = play.cost.discounts;

test("rad-075-167 Skystrike Squadron: program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /return-to-hand/);
  assert.match(program.judgeReason, /RIFT-89/);
  assert.match(program.judgeReason, /RIFT-90/);
});

test("rad-075-167 Skystrike Squadron: sourceText is the verbatim deck-catalog ability text", () => {
  assert.equal(
    program.sourceText,
    "You may return a friendly gear to its owner's hand as an additional cost to play me. " +
      "If you do, I cost :rb_energy_2: less.\n" +
      "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)"
  );
});

test("rad-075-167 Skystrike Squadron: the additional cost is optional (356.2 / 356.4.f.1)", () => {
  assert.equal(play.kind, "play");
  assert.equal(play.cost.kind, "additional-cost");
  assert.equal(play.cost.optional, true);
  assert.equal(play.cost.payments.length, 1);
  assert.deepEqual(play.body, [], "the card has no resolving effect text");
});

test("rad-075-167 Skystrike Squadron: returning the gear is a non-target cost choice (355.10.c)", () => {
  assert.equal(returnedGear.kind, "return-to-hand");
  assert.equal(returnedGear.choice.id, "skystrike-squadron.returned-gear");
  assert.equal(returnedGear.choice.min, 1);
  assert.equal(returnedGear.choice.max, 1);
  assert.equal(returnedGear.choice.selection, "one");
  assert.deepEqual(returnedGear.choice.filter, {
    type: "gear",
    controller: "controller",
    zone: "board"
  });
});

test("rad-075-167 Skystrike Squadron: 'If you do, I cost 2 less' is a conditional 2-energy discount (356.4.c)", () => {
  assert.equal(discount.kind, "cost-modification");
  assert.equal(discount.resource, "energy");
  assert.deepEqual(discount.amount, { kind: "constant", value: -2 });
  // The discount is gated on the optional cost being paid — "if you do" (356.4.f.1).
  assert.equal(discount.condition.kind, "compare");
  assert.equal(discount.condition.operator, "eq");
  assert.deepEqual(discount.condition.right, { kind: "constant", value: true });
});

test("rad-075-167 Skystrike Squadron: [Deflect] carries the printed default value 1 (809.1.b.3)", () => {
  assert.deepEqual(deflectKeyword, { kind: "keyword", keyword: "deflect", value: 1 });
});

test("rad-075-167 Skystrike Squadron: the Deflect keyword expands to a 1-Power target tax (809.1.c / 809.1.c.1)", () => {
  const registered = keywordDefinitionsById.get("Deflect");
  assert.ok(registered, "Deflect is registered in the generated keyword registry");
  const [expansion] = deflect.expand({ host: { canonicalCardId: CARD_ID }, value: 1 });
  assert.equal(expansion.kind, "static");
  assert.equal(expansion.effect.kind, "target.tax");
  assert.deepEqual(expansion.effect.value, { kind: "constant", value: 1 });
});

test("rad-075-167 Skystrike Squadron: the cost pipeline rejects the declared non-scaling payment kind", () => {
  const kernel = world().unit("skystrike-squadron", { might: 4 }).unit("gear-1", { types: ["gear"] }).build();
  assert.throws(
    () =>
      buildCostPlan(kernel, {
        id: "skystrike-optional-cost",
        cost: play.cost
      }),
    error => {
      assert.equal(error.name, "CostPlanError");
      assert.equal(error.reason, "judge-required");
      // The blocking facts behind judge-required: the pipeline rejects the optional marker...
      assert.match(error.message, /optional/);
      // ...and has no "return-to-hand" payment kind at all.
      assert.throws(
        () =>
          buildCostPlan(kernel, {
            id: "skystrike-payment-only",
            cost: { kind: "activated", payments: [returnedGear] }
          }),
        paymentError => {
          assert.equal(paymentError.reason, "judge-required");
          assert.match(paymentError.message, /return-to-hand/);
          return true;
        }
      );
      return true;
    }
  );
});

test("rad-075-167 Skystrike Squadron: the merged pipeline can apply a caller-supplied 2-energy discount", () => {
  // Confirms the *amount* semantics are already supported once the discount reaches the plan;
  // what is missing is discovering it from the paid optional cost (356.4.c/f.1).
  const kernel = world().unit("skystrike-squadron", { might: 4 }).build();
  const plan = buildCostPlan(kernel, {
    id: "unit-play",
    cost: { energy: { kind: "constant", value: 5 } },
    discounts: [
      { id: "skystrike-discount", resource: "energy", amount: { kind: "constant", value: 2 } }
    ]
  });
  assert.equal(plan.total.energy, 3, "a 5 Energy cost reduced by 2");
});

test.todo(
  "rad-075-167 Skystrike Squadron: charge the optional return-a-friendly-gear cost at Finalize and " +
    "apply the resulting 2-Energy discount only when it was paid (356.2 / 356.4.c / 356.4.f.1) — " +
    "cost/plan-values.ts has no return-to-hand payment kind (RIFT-89)"
);

test.todo(
  "rad-075-167 Skystrike Squadron: [Deflect 1] target tax collection — the expansion produces a " +
    "target.tax effect but no caller passes tax options into finalizeTargetPlan " +
    "(chain/engine.ts only installs a tax adapter without a tax source) (RIFT-90)"
);

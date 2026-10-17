import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/eager-apprentice.js";

import costModify from "../../../../engine-core/dist/effects/instructions/cost.modify.js";
import costPay from "../../../../engine-core/dist/effects/instructions/cost.pay.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-e5d8b2e1e9ee0d9e2669fae947f4252a33dfc970df9cd39ad8477263b66fccc6";

test("Eager Apprentice program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /cost\.modify|CostPlanInput\.discounts|cost\/cost-plan/);
  assert.equal(
    program.sourceText,
    "While I'm at a battlefield, the Energy costs for spells you play is reduced by :rb_energy_1:, to a minimum of :rb_energy_1:."
  );
});

test("Eager Apprentice structure: one static cost-modification ability gated on being at a battlefield", () => {
  assert.equal(program.abilities.length, 1);
  const [ability] = program.abilities;
  assert.equal(ability.kind, "static");

  // The discount is Energy-1 with the printed floor of 1 (356.4.e: a discount's
  // minimum applies only to that discount), applied to spells the controller plays.
  assert.equal(ability.effect.kind, "continuous.cost-modification");
  assert.equal(ability.effect.resource, "energy");
  assert.deepEqual(ability.effect.amount, { kind: "constant", value: -1 });
  assert.deepEqual(ability.effect.minimum, { kind: "constant", value: 1 });
  assert.deepEqual(ability.effect.appliesTo, { type: "spell", controller: "controller" });

  // "While I'm at a battlefield": the host must be at a battlefield location.
  assert.equal(ability.condition.kind, "compare");
  assert.equal(ability.condition.operator, "gte");
  assert.deepEqual(ability.condition.right, { kind: "constant", value: 1 });
  assert.deepEqual(ability.condition.left, {
    kind: "count",
    subject: "objects",
    filter: { object: "self", location: "battlefield" }
  });
});

test.todo("Eager Apprentice: collect the battlefield-scoped static spell discount into Chain Finalize (CR 356.4.c–e)");

test("Eager Apprentice supported discount component preserves its own minimum and printed null Power", () => {
  const effect = program.abilities[0].effect;
  for (const [energy, expected] of [[3, 2], [1, 1], [0, 0]]) {
    const base = world().player("A", { energy: 5 })
      .hand("spell", { types: ["spell"], energy, power: null }).build();
    const kernel = base.clone({ sourceSnapshot: base.getObject("spell") });
    const run = runInstruction(costModify, {
      id: "eager-discount",
      modifier: { kind: "reduce", resource: effect.resource,
        amount: { kind: "arithmetic", operator: "multiply", operands: [effect.amount, { kind: "constant", value: -1 }] },
        minimum: effect.minimum }
    }, { world: kernel });
    assert.equal(run.result.status, "executed");
    assert.equal(run.linked.cost.total.energy, expected);
    assert.equal(run.linked.cost.printed.power, null);
    const payment = runInstruction(costPay, { cost: { kind: "constant", value: run.linked.cost } }, { world: kernel });
    assert.equal(payment.result.status, "executed");
    assert.equal(kernel.player("A").energy, 5 - expected);
    assert.equal(kernel.getObject("spell").energy, energy);
    assert.equal(kernel.getObject("spell").power, null);
  }
});

test("Eager Apprentice minimum belongs only to its own discount (CR 356.4.e)", () => {
  const effect = program.abilities[0].effect;
  const base = world().hand("spell", { types: ["spell"], energy: 3, power: null }).build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("spell") });
  const run = runInstruction(costModify, {
    id: "independent-minimum",
    modifiers: [
      { id: "eager", kind: "reduce", resource: "energy", amount: { kind: "constant", value: 1 }, minimum: effect.minimum },
      { id: "other", kind: "reduce", resource: "energy", amount: { kind: "constant", value: 2 } }
    ],
    discountOrder: ["eager", "other"]
  }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.cost.total.energy, 0);
  assert.deepEqual(run.linked.cost.discounts.map(discount => [discount.id, discount.before, discount.after]), [
    ["eager", 3, 2], ["other", 2, 0]
  ]);
});

test("Eager Apprentice discount component includes additional Energy without rewriting null printed costs", () => {
  const effect = program.abilities[0].effect;
  const base = world().player("A", { energy: 3 })
    .hand("spell", { types: ["spell"], energy: null, power: null }).build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("spell") });
  const run = runInstruction(costModify, {
    id: "eager-additional-discount",
    cost: { kind: "explicit", energy: { kind: "constant", value: 1 } },
    mandatoryAdditional: [{ id: "additional", cost: { energy: { kind: "constant", value: 2 } } }],
    modifier: {
      kind: "reduce", resource: effect.resource,
      amount: { kind: "arithmetic", operator: "multiply", operands: [effect.amount, { kind: "constant", value: -1 }] },
      minimum: effect.minimum
    }
  }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked.cost.printed, { energy: null, power: null });
  assert.equal(run.linked.cost.total.energy, 2);
  assert.deepEqual(run.linked.cost.total.power, []);
  assert.deepEqual(run.linked.cost.discounts.map(discount => [discount.before, discount.after]), [[3, 2]]);
  const payment = runInstruction(costPay, { cost: { kind: "constant", value: run.linked.cost } }, { world: kernel });
  assert.equal(payment.result.status, "executed");
  assert.equal(kernel.player("A").energy, 1);
  assert.equal(kernel.getObject("spell").energy, null);
  assert.equal(kernel.getObject("spell").power, null);
});

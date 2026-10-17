// Scenario execution evidence: ../templates/static-666.test.mjs (one row per card plus condition boundaries).
// This file retains validation, identity, and key IR structure checks; whole-card status stays judge-required until all consumers exist.
import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/herald-of-scales.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-8f0ac98c17845f49a654e9543fdfa1946ec646cc7efc52fbd3395790fb4be660";
const [discountAbility] = program.abilities;

test("Herald of Scales program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
});

test("identity: canonicalCardId, ruleset, status, judgeReason, verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /continuous\.cost-modification/);
  assert.match(program.judgeReason, /356\.4/);
  assert.match(program.judgeReason, /programs\/statics\.ts/);
  assert.match(program.judgeReason, /CostPlanInput\.discounts/);
  assert.ok(!/RIFT-\d+/.test(program.judgeReason));
  assert.equal(
    program.sourceText,
    "Your Dragons' Energy costs are reduced by :rb_energy_2:, to a minimum of :rb_energy_1:."
  );
});

test("structure: static Energy discount on the controller's Dragons with a minimum of 1", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(discountAbility.kind, "static");
  assert.equal(discountAbility.effect.kind, "continuous.cost-modification");
  // CR 356.4.c: only the Energy component is discounted; CR 356.4.e: the
  // printed minimum constrains this discount only.
  assert.equal(discountAbility.effect.resource, "energy");
  assert.deepEqual(discountAbility.effect.amount, { kind: "constant", value: -2 });
  assert.deepEqual(discountAbility.effect.minimum, { kind: "constant", value: 1 });
  // "Your Dragons": CR 133.8/133.8.a tags carry no innate meaning; the filter
  // names the Dragon tag and the controller.
  assert.deepEqual(discountAbility.effect.filter, {
    tag: "Dragon",
    controller: "controller"
  });
  // CR 133.8: tags can occur on multiple card types; the text does not say units.
  assert.equal(discountAbility.effect.filter.type, undefined);
  assert.equal(discountAbility.condition, undefined);
});

test.todo(
  "Herald of Scales: feed the static continuous.cost-modification into the cost plan's discount " +
    "step (CR 356.4/356.4.b/356.4.c/356.4.e) so Dragon Energy costs drop by 2 down to a minimum of 1 " +
    "— cost.cost-plan.ts only accepts explicit CostDiscount inputs and has no bridge from this static ability"
);
test.todo(
  "Herald of Scales: the passive ability must apply while the card sits on the board (CR 366.2/366.2.a) " +
    "and register each Herald source exactly once; general static lifecycle registration exists but the cost-plan bridge remains pending"
);

function explicitDiscount(id = "herald") {
  return {
    id, resource: discountAbility.effect.resource,
    amount: { kind: "arithmetic", operator: "neg", operands: [discountAbility.effect.amount] },
    minimum: discountAbility.effect.minimum
  };
}

test("Herald of Scales supported cost planner: Energy minimum is per discount and Power is unchanged", () => {
  for (const [energy, expected] of [[6, 4], [2, 1], [1, 1], [0, 0]]) {
    const initial = world().hand("dragon", { tags: ["Dragon"], energy, power: ["Body"] }).build();
    const kernel = initial.clone({ sourceSnapshot: initial.getObject("dragon") });
    const plan = buildCostPlan(kernel, { id: `dragon-${energy}`, cost: { kind: "printed" }, discounts: [explicitDiscount()] });
    assert.equal(plan.total.energy, expected);
    assert.deepEqual(plan.total.power, [{ amount: 1, allowedDomains: ["Body"] }]);
    assert.equal(plan.printed.energy, energy);
    assert.equal(kernel.getObject("dragon").energy, energy);
    assert.equal(plan.discounts[0].minimum, 1);
  }
});

test("Herald of Scales supported cost planner: another discount can reduce the final Energy below one", () => {
  const initial = world().hand("dragon", { tags: ["Dragon"], energy: 6, power: null }).build();
  const kernel = initial.clone({ sourceSnapshot: initial.getObject("dragon") });
  const plan = buildCostPlan(kernel, {
    id: "dragon-discounts", cost: { kind: "printed" },
    discounts: [explicitDiscount(), { id: "other", resource: "energy", amount: { kind: "constant", value: 4 } }],
    discountOrder: ["herald", "other"]
  });
  assert.equal(plan.total.energy, 0);
  assert.deepEqual(plan.discounts.map(discount => [discount.before, discount.after]), [[6, 4], [4, 0]]);
  assert.equal(plan.printed.power, null);
  assert.equal(kernel.getObject("dragon").power, null);
});

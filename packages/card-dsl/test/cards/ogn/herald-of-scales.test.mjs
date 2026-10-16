import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/herald-of-scales.js";
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
    type: "unit",
    tag: "Dragon",
    controller: "controller"
  });
  assert.equal(discountAbility.condition, undefined);
});

test.todo(
  "Herald of Scales: feed the static continuous.cost-modification into the cost plan's discount " +
    "step (CR 356.4/356.4.b/356.4.c/356.4.e) so Dragon Energy costs drop by 2 down to a minimum of 1 " +
    "— cost.cost-plan.ts only accepts CostDiscount inputs and no cost.modify primitive exists (RIFT-89)"
);
test.todo(
  "Herald of Scales: the passive ability must apply while the card sits on the board (CR 366.2/366.2.a) " +
    "and not stack per Dragon; the layer/lifetime side belongs to the layers workstream (RIFT-91)"
);

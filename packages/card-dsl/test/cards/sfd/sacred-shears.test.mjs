// Execution evidence (README 4.1): the Equip activation of Sacred Shears runs through the
// real ProgramBinding/ChainEngine path in test/cards/templates/keyword-equip-printed-power-882.test.mjs.
import assert from "node:assert/strict";
import test from "node:test";
import {
  EFFECT_IR_V2_RULESET,
  validateCardProgram
} from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/sacred-shears.js";

test("Sacred Shears card program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? null : result.issues));
  assert.equal(program.canonicalCardId, "card.hash-d3579e6825470471f5ce05c53533806a5244c5e84364fe57b2aab0b7cc0f14e0");
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "executable");
  assert.equal(program.sourceText, "[Equip] :rb_rune_order: (:rb_rune_order:: Attach this to a unit you control.)");
});

test("Sacred Shears hosts a valued Order Equip keyword", () => {
  assert.equal(program.abilities.length, 1);
  const [equip] = program.abilities;
  assert.equal(equip.kind, "keyword");
  assert.equal(equip.keyword, "equip");
  assert.equal(equip.value, 1);
  assert.equal(equip.costDomain, "Order");
});

test("Sacred Shears carries its printed Equip cost as exactly one Order Power through params.cost", () => {
  const [equip] = program.abilities;
  assert.deepEqual(equip.params, {
    cost: {
      kind: "activated",
      payments: [{ kind: "power", amount: { kind: "constant", value: 1 }, allowedDomains: ["Order"] }]
    }
  });
  assert.equal(equip.params.cost.energy, undefined);
  assert.equal(equip.params.cost.payments.some(payment => payment.kind === "equip"), false);
});

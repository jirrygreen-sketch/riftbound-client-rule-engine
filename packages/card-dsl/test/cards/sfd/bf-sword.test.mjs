// Execution evidence (README 4.1): the Equip activation of B.F. Sword runs through the
// real ProgramBinding/ChainEngine path in test/cards/templates/keyword-equip-printed-power-882.test.mjs.
import assert from "node:assert/strict";
import test from "node:test";
import {
  EFFECT_IR_V2_RULESET,
  validateCardProgram
} from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/bf-sword.js";

test("B.F. Sword card program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? null : result.issues));
  assert.equal(program.canonicalCardId, "card.hash-959c19d68f06f8f929625bfde93a1132701da5a5d0b49e91583db341384f0bfe");
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "executable");
  assert.equal(program.sourceText, "[Equip] :rb_rune_order: (:rb_rune_order:: Attach this to a unit you control.)");
});

test("B.F. Sword hosts a valued Order Equip keyword", () => {
  assert.equal(program.abilities.length, 1);
  const [equip] = program.abilities;
  assert.equal(equip.kind, "keyword");
  assert.equal(equip.keyword, "equip");
  assert.equal(equip.value, 1);
  assert.equal(equip.costDomain, "Order");
});

test("B.F. Sword carries its printed Equip cost as exactly one Order Power through params.cost", () => {
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

// Golden test for Applied Researchers (ven-055-166).
//
// Execution evidence (the real printed 4 Energy payment, the still-inert
// [Empowered] spell discount — verified both before and after a real Empower
// action — and the fail-closed continuous.cost-modification binds) lives in the
// RIFT-673 parameterized template golden:
// test/cards/templates/keyword-static-static-673.test.mjs.
// This file keeps validation, identity, verbatim text, declared status and the
// key structure of the printed abilities.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/applied-researchers.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const CARD_ID = "card.hash-ffb7fa0eb6027d1158053512ab5917c1ff4226d11f9110deeade65133c7312b4";
const SOURCE_TEXT =
  "[Empower] :rb_energy_3: (:rb_energy_3:: Empower me. Use only if not Empowered.)\n" +
  "[Empowered][>] Your spells cost :rb_energy_1::rb_rune_rainbow: less, to a minimum of :rb_energy_1:.";

const [empower, energyDiscount, powerDiscount] = program.abilities;

test("ven-055-166 Applied Researchers: program validates and is registered by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(cardRegistryById.get(CARD_ID), program);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("ven-055-166 Applied Researchers: judgeReason names the current cost-plan and Empowered gaps", () => {
  assert.match(program.judgeReason, /Empower/);
  assert.match(program.judgeReason, /827\.1\.c\.1/);
  assert.match(program.judgeReason, /828\.1\.c/);
  assert.match(program.judgeReason, /CostPlanInput\.discounts/);
  assert.match(program.judgeReason, /356\.4\.e/);
  assert.match(program.judgeReason, /spell-play-cost/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("ven-055-166 Applied Researchers: Empower 3 is declared, and both discount components are Empowered-gated", () => {
  assert.deepEqual(empower, { kind: "keyword", keyword: "empower", value: 3 });

  for (const ability of [energyDiscount, powerDiscount]) {
    assert.equal(ability.kind, "static");
    assert.equal(ability.effect.kind, "continuous.cost-modification");
    assert.equal(ability.effect.amount, -1);
    assert.equal(ability.effect.appliesTo, "spell-play-cost");
    assert.deepEqual(ability.effect.filter, { type: "spell", controller: "self" });
    assert.deepEqual(ability.condition, {
      kind: "compare",
      left: { kind: "object-property", object: "self", property: "empowered" },
      operator: "gte",
      right: { kind: "constant", value: 1 }
    });
  }
});

test("ven-055-166 Applied Researchers: the Energy component carries the 356.4.e minimum of 1", () => {
  assert.equal(energyDiscount.effect.resource, "energy");
  assert.equal(energyDiscount.effect.minimum, 1);
  assert.equal(energyDiscount.effect.domain, undefined);
});

test("ven-055-166 Applied Researchers: the Power component is 1 Power of any Domain without a minimum", () => {
  assert.equal(powerDiscount.effect.resource, "power");
  // 135.2.e.5 / 135.2.e.5.a：:rb_rune_rainbow: 是任意域 Power。
  assert.equal(powerDiscount.effect.domain, "any");
  // 356.4.e 的最低值只属于写出它的那条折扣；Power 分量没有印刷最低值。
  assert.equal(powerDiscount.effect.minimum, undefined);
});

test.todo(
  "ven-055-166 Applied Researchers: pass the printed Empower 3 cost through KeywordAbility/params.cost and " +
    "carry the Empowered-gated -1 Energy / -1 any-Domain Power discount into the spell's Finalize cost plan " +
    "(827.1.c.1 / 356.4.e); the merged spell-play-cost static has no binding or consumer"
);

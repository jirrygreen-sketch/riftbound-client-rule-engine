import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/applied-researchers.js";

const [empower, energyDiscount, powerDiscount] = program.abilities;

test("applied-researchers: passes validateCardProgram and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(
    program.canonicalCardId,
    "card.hash-ffb7fa0eb6027d1158053512ab5917c1ff4226d11f9110deeade65133c7312b4"
  );
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(
    program.sourceText,
    "[Empower] :rb_energy_3: (:rb_energy_3:: Empower me. Use only if not Empowered.)\n" +
      "[Empowered][>] Your spells cost :rb_energy_1::rb_rune_rainbow: less, to a minimum of :rb_energy_1:."
  );
});

test("applied-researchers: judgeReason names the cost-plan and layers gaps", () => {
  assert.match(program.judgeReason, /Empower/);
  assert.match(program.judgeReason, /827\.1\.c\.1/);
  assert.match(program.judgeReason, /828\.1\.c/);
  assert.match(program.judgeReason, /CostDiscount/);
  assert.match(program.judgeReason, /356\.4\.e/);
  assert.match(program.judgeReason, /RIFT-89/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("applied-researchers: Empower 3 is declared, and both discount components are Empowered-gated", () => {
  assert.deepEqual(empower, { kind: "keyword", keyword: "empower", value: 3 });

  for (const ability of [energyDiscount, powerDiscount]) {
    assert.equal(ability.kind, "static");
    assert.equal(ability.effect.kind, "continuous.cost-modification");
    assert.equal(ability.effect.amount, -1);
    assert.equal(ability.effect.appliesTo, "spell-play-cost");
    assert.deepEqual(ability.effect.filter, { type: "spell", controller: "self" });
    assert.deepEqual(ability.condition, {
      kind: "expression",
      value: { kind: "constant", value: "empowered" }
    });
  }
});

test("applied-researchers: the Energy component carries the 356.4.e minimum of 1", () => {
  assert.equal(energyDiscount.effect.resource, "energy");
  assert.equal(energyDiscount.effect.minimum, 1);
  assert.equal(energyDiscount.effect.domain, undefined);
});

test("applied-researchers: the Power component is 1 Power of any Domain without a minimum", () => {
  assert.equal(powerDiscount.effect.resource, "power");
  // 135.2.e.5 / 135.2.e.5.a：:rb_rune_rainbow: 是任意域 Power。
  assert.equal(powerDiscount.effect.domain, "any");
  // 356.4.e 的最低值只属于写出它的那条折扣；Power 分量没有印刷最低值。
  assert.equal(powerDiscount.effect.minimum, undefined);
});

test.todo(
  "applied-researchers: [Empower] 3 activation and the Empowered gate on the discount " +
    "(827.1.c.1 / 828.1.c; RIFT-83/84 keyword expansions)"
);
test.todo(
  "applied-researchers: feed 'your spells cost 1 Energy and 1 any-Domain Power less, to a minimum " +
    "of 1 Energy' into the cost plan as a CostDiscount (356.4.a-d ordering, 356.4.e per-discount " +
    "minimum) once CardProgram static effects are wired into buildCostPlan (RIFT-89); the merged " +
    "CostDiscount input has no CardProgram source"
);

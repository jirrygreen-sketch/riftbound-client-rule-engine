// Golden test for Grumpy Rockbear (ven-050-166).
//
// Execution evidence (the registered per-rune cost rewrite behind its
// fail-closed bind, the Empowered-gated Deflect 1 / Shield 3 grant with both
// the Empower and Disempower boundaries and the blocked printed [Empower]
// activation) lives in the RIFT-673 parameterized template golden:
// test/cards/templates/keyword-static-static-673.test.mjs.
// This file keeps validation, identity, verbatim text, declared status and the
// key structure of the printed abilities.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/grumpy-rockbear.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const [empower, costReduction, grantedKeywords] = program.abilities;

test("grumpy-rockbear: passes validateCardProgram and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(
    program.canonicalCardId,
    "card.hash-1318a3352539e807f9e1630c856d2c196aa0c08582d7d3c992b230a01f6fe243"
  );
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
  assert.equal(
    program.sourceText,
    "[Empower] :rb_energy_12:. This ability costs :rb_energy_1: less for each rune you control. (Pay the cost: Empower me. Use only if not Empowered.)\n" +
      "[Empowered][>] I have [Deflect] and [Shield 3]. (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.+3 :rb_might: while I'm a defender.)"
  );
});

test("grumpy-rockbear: judgeReason names the keyword, cost and layer gaps", () => {
  assert.match(program.judgeReason, /Empower/);
  assert.match(program.judgeReason, /Empowered/);
  assert.match(program.judgeReason, /827\.1\.c\.1/);
  assert.match(program.judgeReason, /827\.1\.c\.3/);
  assert.match(program.judgeReason, /827\.1\.c\.5/);
  assert.match(program.judgeReason, /828\.1\.c/);
  assert.match(program.judgeReason, /continuous\.grant-keyword/);
  assert.match(program.judgeReason, /442\.1\.a/);
  assert.match(program.judgeReason, /empower-activation-cost/);
  assert.match(program.judgeReason, /RIFT-359/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("grumpy-rockbear: Empower 12 is declared with the printed cost and not expanded", () => {
  assert.deepEqual(empower, { kind: "keyword", keyword: "empower", value: 12 });
  assert.equal(empower.params, undefined);
});

test("grumpy-rockbear: the 'costs 1 less per rune' clause is a cost rewrite of that Empower activation", () => {
  // 827.1.c.3 / 206.1：该文本是 Empower 起动费用的一部分，不是独立效果。
  assert.equal(costReduction.kind, "static");
  const effect = costReduction.effect;
  assert.equal(effect.kind, "continuous.cost-modification");
  assert.equal(effect.resource, "energy");
  assert.equal(effect.appliesTo, "empower-activation-cost");
  assert.equal(effect.per, "rune-you-control");
  assert.equal(effect.minimum, 0);
  assert.deepEqual(effect.amount, {
    kind: "arithmetic",
    operator: "neg",
    operands: [{
      kind: "count",
      subject: "runes",
      filter: { type: "rune", controller: "self", zone: "rune-zone" }
    }]
  });
  // 既不写死具体减免数值，也不自行改写费用。
  assert.equal(costReduction.condition, undefined);
});

test("grumpy-rockbear: the Empowered dependent ability grants Deflect 1 and Shield 3 to self", () => {
  assert.equal(grantedKeywords.kind, "static");
  assert.deepEqual(grantedKeywords.effect, {
    kind: "continuous.grant-keyword",
    appliesTo: "self",
    keywords: [
      { id: "deflect", value: 1 },
      { id: "shield", value: 3 }
    ]
  });
  // 828.1.b/828.1.c：依赖能力只在拥有 Empowered 状态时 Active；
  // 门控读取实时 empowered 状态，不使用恒真的字符串。
  assert.deepEqual(grantedKeywords.condition, {
    kind: "compare",
    left: { kind: "object-property", object: "self", property: "empowered" },
    operator: "gte",
    right: { kind: "constant", value: 1 }
  });
});

test.todo(
  "grumpy-rockbear: the 827.1.c.3 cost-rewrite static (continuous.cost-modification, appliesTo " +
    "empower-activation-cost) has no staticTarget/layerFor mapping in programs/statics.ts and " +
    "fails closed when bound (Unsupported static appliesTo), and the printed 12 Energy still cannot " +
    "cross the KeywordAbility boundary (827.1.c.1)"
);
test.todo(
  "grumpy-rockbear: the granted Deflect Power tax and the Shield 3 defender expansion still need " +
    "Chain Finalize / combat consumers (809.1.c / 814.1.c)"
);

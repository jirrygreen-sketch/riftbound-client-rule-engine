// Golden test for Baccai Sandspinner (ven-001-166).
//
// Execution evidence (the real printed 6 Energy payment, the Empowered-gated
// Deflect 1 / Assault 2 grant with the Disempower boundary, the fail-closed
// cost-modification bind and the blocked printed expectations) lives in the
// RIFT-673 parameterized template golden:
// test/cards/templates/keyword-static-static-673.test.mjs.
// This file keeps validation, identity, verbatim text, declared status and the
// key structure of the printed abilities.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/baccai-sandspinner.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const CARD_ID = "card.hash-43ef38def4a837781a4013a179db99f1eb1e312f85de8d9c3053f7168a1652f5";
const SOURCE_TEXT =
  "[Empower] :rb_energy_5:. This ability costs :rb_energy_3: less if you control 4 or fewer runes. " +
  "(Pay the cost: Empower me. Use only if not Empowered.)\n" +
  "[Empowered][>] I have [Deflect] and [Assault 2]. (Opponents must pay :rb_rune_rainbow: to choose me " +
  "with a spell or ability. +2 :rb_might: while I'm an attacker.)";

const [empower, costReduction, grantedKeywords] = program.abilities;

test("ven-001-166 Baccai Sandspinner: program validates and is registered by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(result.issues.length, 0);
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(cardRegistryById.get(CARD_ID), program);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("ven-001-166 Baccai Sandspinner: judgeReason names the current gaps", () => {
  assert.match(program.judgeReason, /Empower/);
  assert.match(program.judgeReason, /827\.1\.c\.1/);
  assert.match(program.judgeReason, /continuous\.cost-modification/);
  assert.match(program.judgeReason, /continuous\.grant-keyword/);
  assert.match(program.judgeReason, /ObjectSnapshot/);
  assert.match(program.judgeReason, /Chain Finalize/);
  assert.ok(!/RIFT-89|RIFT-90|RIFT-91/.test(program.judgeReason));
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("ven-001-166: [Empower] declares the printed 5 Energy", () => {
  // 827.1.c.1 / 827.1.c.3：印刷费用只记录在关键词上；费用改写是下一条 static。
  assert.deepEqual(empower, { kind: "keyword", keyword: "empower", value: 5 });
});

test("ven-001-166: the '4 or fewer runes' clause rewrites this Empower activation cost", () => {
  assert.equal(costReduction.kind, "static");
  const effect = costReduction.effect;
  assert.equal(effect.kind, "continuous.cost-modification");
  assert.equal(effect.resource, "energy");
  assert.equal(effect.appliesTo, "empower-activation-cost");
  assert.deepEqual(effect.amount, { kind: "constant", value: -3 });
  // 356.6：Energy 费用不能被减到 0 以下。
  assert.equal(effect.minimum, 0);
  // 133.5.a.1 / 431.1：“you control 4 or fewer runes” 只数控制者符文区中的符文。
  assert.deepEqual(costReduction.condition, {
    kind: "compare",
    left: {
      kind: "count",
      subject: "runes",
      filter: { type: "rune", controller: "self", zone: "rune-zone" }
    },
    operator: "lte",
    right: { kind: "constant", value: 4 }
  });
});

test("ven-001-166: the Empowered dependent ability grants Deflect 1 and Assault 2 to self", () => {
  // 828.1.b.1：等价于「持有 Empowered 时本牌获得 '[Text]'」。
  assert.equal(grantedKeywords.kind, "static");
  assert.deepEqual(grantedKeywords.effect, {
    kind: "continuous.grant-keyword",
    appliesTo: "self",
    keywords: [
      { id: "deflect", value: 1 },
      { id: "assault", value: 2 }
    ]
  });
  // 809.1.b.3 的省略值按 1、807.1.b 的印刷值 2 各自保留；卡内不重写展开。
  // 828.1.c 的门控使用来源的实时 empowered 计数。
  assert.deepEqual(grantedKeywords.condition, {
    kind: "compare",
    left: { kind: "object-property", object: "self", property: "empowered" },
    operator: "gte",
    right: { kind: "constant", value: 1 }
  });
});

test.todo(
  "ven-001-166 Baccai Sandspinner: pass the printed Empower 5 cost and its conditional -3 Energy discount into the " +
    "card's own activation Finalize (827.1.c.1 / 827.1.c.3); the empower payment kind and the " +
    "continuous.cost-modification binding are missing"
);
test.todo(
  "ven-001-166 Baccai Sandspinner: the granted Assault 2 needs the attacker designation and the granted Deflect needs " +
    "its Power target tax wired into Chain Finalize (807.1.c / 809.1.c / 828.1.c)"
);

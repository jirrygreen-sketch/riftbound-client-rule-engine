import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/legion-marauder.js";

const CANONICAL_ID =
  "card.hash-211eca36faf7df8cbf91263292d612607b7b7e515ee1ee6aaeb0003817aff8f8";
const SOURCE_TEXT =
  "[Empower] \u2014 :rb_energy_1: or :rb_rune_body: (Pay either cost: Empower me. Use only if " +
  "not Empowered.)\n" +
  "[Empowered][>] I have +1 :rb_might:.";

const [empower, mightBonus] = program.abilities;

test("ven-074-166 Legion Marauder: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ven-074-166 Legion Marauder: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /Empower/);
  assert.match(program.judgeReason, /827\.1\.c\.1/);
  assert.match(program.judgeReason, /827\.1\.c\.2/);
  assert.match(program.judgeReason, /442\.1\.a/);
  assert.match(program.judgeReason, /RIFT-87/);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.doesNotMatch(program.judgeReason, /RIFT-91 只合入|没有 CardProgram/);
});

test("ven-074-166 Legion Marauder: [Empower] is declared without faking the either-or cost", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(empower, { kind: "keyword", keyword: "empower" });
  assert.equal(empower.value, undefined);
  // 827.1.c.2 的“1 Energy 或 1 Body Power”二选一费用没有承载字段：
  // KeywordAbility 只有 keyword / value（number），不得伪造第二条启动能力。
  assert.equal(program.abilities.filter(ability => ability.kind === "activated").length, 0);
});

test("ven-074-166 Legion Marauder: 'I have +1 :rb_might:' is the gated arithmetic shape", () => {
  assert.equal(mightBonus.kind, "static");
  assert.equal(mightBonus.effect.kind, "continuous.might");
  assert.equal(mightBonus.effect.mode, "add");
  assert.equal(mightBonus.effect.layer, "arithmetic");
  assert.deepEqual(mightBonus.effect.amount, { kind: "constant", value: 1 });
  assert.equal(mightBonus.effect.appliesTo, "self");
  // 442.1.a / 828.1.c：Empowered 门槛（描述性谓词，无已合入求值路径）。
  assert.equal(mightBonus.condition.kind, "compare");
  assert.equal(mightBonus.condition.operator, "gte");
  assert.deepEqual(mightBonus.condition.left, {
    kind: "object-property",
    object: "self",
    property: "empoweredCount"
  });
  assert.deepEqual(mightBonus.condition.right, { kind: "constant", value: 1 });
});

test("ven-074-166 Legion Marauder: the printed sourceText keeps the em dash verbatim", () => {
  // 数据问题检查：印刷号文本里的 “—”（U+2014）必须原样保留，不能替换成连字符。
  assert.ok(program.sourceText.includes("\u2014"));
  assert.equal(program.sourceText.includes(" - "), false);
});

test.todo(
  "ven-074-166 Legion Marauder: [Empower] expansion (827.1.c.1 cost + 'use only if not Empowered') and the " +
    "either-or printed cost (827.1.c.2 'Pay either cost: 1 Energy or 1 Body Power') need an Empower KeywordDef " +
    "plus a cost carrier on the card ability — none is merged"
);
test.todo(
  "ven-074-166 Legion Marauder: the +1 Might half needs an Empowered status predicate (442.1.a; RIFT-87) and a " +
    "working Empowered gate; the continuous.might primitive and static registration are merged"
);

// Golden test for Kinkou Lifeblade (ven-093-166).
//
// Execution evidence (the real printed 4 Energy payment, the Empowered-gated
// +1 Might and Ganking grant with its Disempower boundary and the blocked
// printed [Empower] activation) lives in the RIFT-673 parameterized template
// golden: test/cards/templates/keyword-static-static-673.test.mjs.
// This file keeps validation, identity, verbatim text, declared status and the
// key structure of the printed abilities.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/kinkou-lifeblade.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const CANONICAL = "card.hash-d74e1963dafb67a09e7521faddbcaaae4df80b1f2ea284a6639fdc31e3e82f35";
const SOURCE_TEXT =
  "[Empower] :rb_energy_2: (:rb_energy_2:: Empower me. Use only if not Empowered.)\n" +
  "[Empowered][>] I have +1 :rb_might: and [Ganking]. (I can move from battlefield to battlefield.)";

const [empower, mightGrant, keywordGrant] = program.abilities;

test("ven-093-166 Kinkou Lifeblade: program validates and is registered by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("ven-093-166 Kinkou Lifeblade: judgeReason names the current gaps", () => {
  assert.match(program.judgeReason, /Empower/);
  assert.match(program.judgeReason, /827\.1\.c\.1/);
  assert.match(program.judgeReason, /ObjectSnapshot/);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /continuous\.grant-keyword/);
  assert.match(program.judgeReason, /Ganking/);
  assert.doesNotMatch(program.judgeReason, /RIFT-91 只合入|没有 .*continuous\.grant-keyword/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("ven-093-166 Kinkou Lifeblade: [Empower] records the printed 2 Energy as a review-only value", () => {
  assert.equal(program.abilities.length, 3);
  assert.deepEqual(empower, { kind: "keyword", keyword: "empower", value: 2 });
  // 827.1.c.1 的费用与“仅当未 Empowered 时”限制属于 KeywordDef 的展开
  //（README 第 5 节：卡文件只声明关键词身份，不自己重写展开）；展开依赖见 judgeReason。
  // value 只保留印刷符号数记录，不是可执行费用（KeywordAbility 无 params.cost）。
  assert.equal(empower.params, undefined);
});

test("ven-093-166 Kinkou Lifeblade: the Empowered +1 Might is an arithmetic-layer modification (479.4.e.1)", () => {
  assert.equal(mightGrant.kind, "static");
  assert.equal(mightGrant.effect.kind, "continuous.might");
  assert.equal(mightGrant.effect.mode, "add");
  assert.equal(mightGrant.effect.layer, "arithmetic");
  assert.equal(mightGrant.effect.appliesTo, "self");
  assert.deepEqual(mightGrant.effect.amount, { kind: "constant", value: 1 });
  // 828.1.b.1 的门槛读取参考内核 empowered；生产状态契约仍缺。
  assert.equal(mightGrant.condition.kind, "compare");
  assert.equal(mightGrant.condition.operator, "gte");
  assert.deepEqual(mightGrant.condition.left, {
    kind: "object-property", object: "self", property: "empowered"
  });
  assert.deepEqual(mightGrant.condition.right, { kind: "constant", value: 1 });
});

test("ven-093-166 Kinkou Lifeblade: the Empowered [Ganking] grant names the merged keyword id", () => {
  assert.equal(keywordGrant.kind, "static");
  // 828.1.b.1 的依赖能力在宿主 Empowered 时授予 Ganking（810）；展开归
  // effects/keywords/Ganking.ts，卡文件只声明关键词身份。
  assert.deepEqual(keywordGrant.effect, {
    kind: "continuous.grant-keyword",
    keyword: "Ganking",
    appliesTo: "self"
  });
  assert.equal(keywordGrant.condition.kind, "compare");
  assert.equal(keywordGrant.condition.operator, "gte");
});

test.todo(
  "ven-093-166 Kinkou Lifeblade: [Empower] 2 Energy activation (827.1.c.1 cost.activated + effect.empower, " +
    "'Use only if not Empowered') needs KeywordAbility params.cost and programs/keywords printed-cost forwarding"
);

test.todo(
  "ven-093-166 Kinkou Lifeblade: the granted [Ganking] still needs a movement consumer reading " +
    "permission.routes (810.1.c, 144.4.c) and the 442.1.a Empowered state contract for production ObjectSnapshot"
);

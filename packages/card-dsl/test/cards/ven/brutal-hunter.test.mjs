// Golden test for Brutal Hunter (ven-070-166).
//
// Execution evidence (the real printed 3 Energy + 1 Body Power payment, the
// Empowered-gated +2 Might and Ganking grant with its Disempower boundary and
// the blocked printed [Empower] activation) lives in the RIFT-673 parameterized
// template golden: test/cards/templates/keyword-static-static-673.test.mjs.
// This file keeps validation, identity, verbatim text, declared status and the
// key structure of the printed abilities.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/brutal-hunter.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const CANONICAL_ID =
  "card.hash-3f9f5a7cd793affe45d17580dab715f09ada17e0f10121517e9abce676d36e2b";
const SOURCE_TEXT =
  "[Empower] :rb_energy_3: (:rb_energy_3:: Empower me. Use only if not Empowered.)\n" +
  "[Empowered][>] I have +2 :rb_might: and [Ganking]. (I can move from battlefield to battlefield.)";

const [empower, mightBonus, gankingGrant] = program.abilities;

test("ven-070-166 Brutal Hunter: program validates and is registered by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("ven-070-166 Brutal Hunter: judgeReason names the current gaps", () => {
  // The current gaps: the printed Empower cost cannot reach expand (contract
  // 3.8.3 production side) and the cost pipeline has no empower payment kind.
  assert.match(program.judgeReason, /827\.1\.c/);
  assert.match(program.judgeReason, /3\.8\.3/);
  assert.match(program.judgeReason, /Unsupported cost kind empower|Unsupported payment kind/);
  // The stale "no Empower/Empowered KeywordDef" and "no status predicate"
  // claims are gone: RIFT-593 merged both.
  assert.ok(!/没有 Empower \/ Empowered 的 KeywordDef/.test(program.judgeReason));
  assert.ok(!/没有 Empowered 状态谓词/.test(program.judgeReason));
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("ven-070-166 Brutal Hunter: [Empower] records the printed 3 Energy as a review-only value", () => {
  // 827.1.c.1：印刷费 3 Energy 只作可审查记录（value）；KeywordAbility 没有
  // params.cost 承载字段，所以 value 不是可执行费用（judgeReason 第 1 条）。
  assert.deepEqual(empower, { kind: "keyword", keyword: "empower", value: 3 });
  assert.equal(empower.params, undefined);
  // 不伪造第二条启动能力；展开（cost.activated + effect.empower）归 keywords/。
  assert.equal(program.abilities.filter(ability => ability.kind === "activated").length, 0);
});

test("ven-070-166 Brutal Hunter: 'I have +2 :rb_might:' is a gated arithmetic layer effect", () => {
  assert.equal(mightBonus.kind, "static");
  // 143.2.a / 475-477：Might 修正属算术图层，不是 Buff 计数器（702-704）。
  assert.equal(mightBonus.effect.kind, "continuous.might");
  assert.equal(mightBonus.effect.mode, "add");
  assert.equal(mightBonus.effect.layer, "arithmetic");
  assert.deepEqual(mightBonus.effect.amount, { kind: "constant", value: 2 });
  assert.equal(mightBonus.effect.appliesTo, "self");
  // 442.1.a / 828.1.c：Empowered 门槛，属性拼写与已合入 Empower.ts 的展开一致。
  assert.equal(mightBonus.condition.kind, "compare");
  assert.equal(mightBonus.condition.operator, "gte");
  assert.deepEqual(mightBonus.condition.left, {
    kind: "object-property",
    object: "self",
    property: "empowered"
  });
  assert.deepEqual(mightBonus.condition.right, { kind: "constant", value: 1 });
});

test("ven-070-166 Brutal Hunter: 'and [Ganking]' is a conditional keyword grant, never a Buff", () => {
  assert.equal(gankingGrant.kind, "static");
  // 810.1.b / 810.3：Ganking 是 Passive Ability 关键词，只声明身份；
  // 展开（continuous.movement）归 effects/keywords/Ganking.ts。
  assert.equal(gankingGrant.effect.kind, "continuous.grant-keyword");
  assert.equal(gankingGrant.effect.keyword, "Ganking");
  assert.equal(gankingGrant.effect.appliesTo, "self");
  assert.deepEqual(gankingGrant.condition, mightBonus.condition);
  // 702-704：授予关键词不是 Buff 计数。
  assert.equal(mightBonus.effect.buffs, undefined);
});

test.todo(
  "ven-070-166 Brutal Hunter: the printed [Empower] 3 activation needs KeywordAbility/params.cost wiring into " +
    "expandProgram and an empower payment kind in the cost pipeline (827.1.c.1 / 827.1.c.2)"
);
test.todo(
  "ven-070-166 Brutal Hunter: the granted [Ganking] needs a movement consumer reading permission.routes " +
    "(810.1.b / 144.4.c.1)"
);

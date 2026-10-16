import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/brutal-hunter.js";

const CANONICAL_ID =
  "card.hash-3f9f5a7cd793affe45d17580dab715f09ada17e0f10121517e9abce676d36e2b";
const SOURCE_TEXT =
  "[Empower] :rb_energy_3: (:rb_energy_3:: Empower me. Use only if not Empowered.)\n" +
  "[Empowered][>] I have +2 :rb_might: and [Ganking]. (I can move from battlefield to battlefield.)";

const [empower, mightBonus, gankingGrant] = program.abilities;

test("ven-070-166 Brutal Hunter: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ven-070-166 Brutal Hunter: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /Empower/);
  assert.match(program.judgeReason, /827\.1\.c\.1/);
  assert.match(program.judgeReason, /442\.1\.a/);
  assert.match(program.judgeReason, /RIFT-87/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("ven-070-166 Brutal Hunter: [Empower] is declared as a keyword ability", () => {
  assert.deepEqual(empower, { kind: "keyword", keyword: "empower" });
  assert.equal(empower.value, undefined);
  // 827.1.c.1 的启动费用与 828.1.b.1 的依赖能力都无展开实现，故不写成启动能力。
  assert.equal(program.abilities.filter(ability => ability.kind === "activated").length, 0);
});

test("ven-070-166 Brutal Hunter: 'I have +2 :rb_might:' is a gated arithmetic layer effect", () => {
  assert.equal(mightBonus.kind, "static");
  assert.equal(mightBonus.effect.kind, "continuous.might");
  assert.equal(mightBonus.effect.mode, "add");
  assert.equal(mightBonus.effect.layer, "arithmetic");
  assert.deepEqual(mightBonus.effect.amount, { kind: "constant", value: 2 });
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

test("ven-070-166 Brutal Hunter: 'and [Ganking]' is a gated ability-layer keyword grant", () => {
  assert.equal(gankingGrant.kind, "static");
  assert.equal(gankingGrant.effect.kind, "continuous.grant-keyword");
  // 810.1.b：被授予的关键词本体由已合入的 keywords/Ganking.ts 展开。
  assert.equal(gankingGrant.effect.keyword, "Ganking");
  assert.equal(gankingGrant.effect.appliesTo, "self");
  assert.deepEqual(gankingGrant.condition, mightBonus.condition);
});

test("ven-070-166 Brutal Hunter: no keyword is declared unconditionally on the card face", () => {
  // [Ganking] 只在 Empowered 后获得；不得写成卡级关键词能力（那会变成始终拥有）。
  assert.equal(program.abilities.filter(ability => ability.kind === "keyword").length, 1);
  assert.deepEqual(program.abilities[0], { kind: "keyword", keyword: "empower" });
});

test.todo(
  "ven-070-166 Brutal Hunter: [Empower] expansion (827.1.c.1: 3 Energy, 'use only if not Empowered') and the " +
    "[Empowered][>] dependent ability (828.1.b.1) need an Empower/Empowered KeywordDef — none is merged"
);
test.todo(
  "ven-070-166 Brutal Hunter: the +2 Might half needs a card-side continuous.might registration into layers " +
    "(RIFT-91) and an Empowered status predicate (442.1.a; RIFT-87)"
);
test.todo(
  "ven-070-166 Brutal Hunter: granting [Ganking] through continuous.grant-keyword needs a card-side registration " +
    "path into layers/engine.ts applyKeyword — no CardProgram → ContinuousEffectSpec producer is merged (RIFT-91)"
);


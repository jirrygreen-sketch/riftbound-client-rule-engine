import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/kinkou-lifeblade.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
import ganking from "../../../../engine-core/dist/effects/keywords/Ganking.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";

const CANONICAL = "card.hash-d74e1963dafb67a09e7521faddbcaaae4df80b1f2ea284a6639fdc31e3e82f35";
const SOURCE_TEXT =
  "[Empower] :rb_energy_2: (:rb_energy_2:: Empower me. Use only if not Empowered.)\n" +
  "[Empowered][>] I have +1 :rb_might: and [Ganking]. (I can move from battlefield to battlefield.)";

const [empower, mightGrant, keywordGrant] = program.abilities;

test("ven-093-166 Kinkou Lifeblade: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("ven-093-166 Kinkou Lifeblade: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
  assert.match(program.judgeReason, /Empower/);
  assert.match(program.judgeReason, /828\.1\.b\.1/);
  assert.match(program.judgeReason, /RIFT-87/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("ven-093-166 Kinkou Lifeblade: [Empower] 2 Energy stays a keyword declaration", () => {
  assert.equal(program.abilities.length, 3);
  assert.deepEqual(empower, { kind: "keyword", keyword: "empower" });
  // 827.1.c.1 的费用与“仅当未 Empowered 时”限制属于 KeywordDef 的展开
  //（README 第 5 节：卡文件只声明关键词身份，不自己重写展开）；展开依赖见 judgeReason。
  assert.equal(empower.value, undefined);
});

test("ven-093-166 Kinkou Lifeblade: the Empowered +1 Might is an arithmetic-layer modification (479.4.e.1)", () => {
  assert.equal(mightGrant.kind, "static");
  assert.equal(mightGrant.effect.kind, "continuous.might");
  assert.equal(mightGrant.effect.mode, "add");
  assert.equal(mightGrant.effect.layer, "arithmetic");
  assert.equal(mightGrant.effect.appliesTo, "self");
  assert.deepEqual(mightGrant.effect.amount, { kind: "constant", value: 1 });
  // 828.1.b.1 的依赖门槛（442.1.a 的二元状态）不可求值：empoweredCount 只是描述性记录。
  assert.equal(mightGrant.condition.kind, "compare");
  assert.equal(mightGrant.condition.operator, "gte");
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
  // 关键词 id 必须对齐已注册的 KeywordDef。
  assert.equal(keywordDefinitionsById.get("Ganking"), ganking);
});

test.todo(
  "ven-093-166 Kinkou Lifeblade: [Empower] 2 Energy activation (827.1.c.1 cost.activated + effect.empower, " +
    "'Use only if not Empowered') needs an Empower KeywordDef — none is merged (RIFT-83/84)"
);

test.todo(
  "ven-093-166 Kinkou Lifeblade: both [Empowered][>] dependent abilities (828.1.b.1) need an Empowered status " +
    "predicate (442.1.a, RIFT-87), the card-side continuous.might entry point (RIFT-91) and a " +
    "continuous.grant-keyword instruction"
);

test.todo(
  "ven-093-166 Kinkou Lifeblade: the granted [Ganking] cannot resolve until the movement system consumes its " +
    "continuous.movement permission (810.1.c, 144.4.c)"
);

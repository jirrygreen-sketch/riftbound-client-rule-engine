import assert from "node:assert/strict";
import test from "node:test";
import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/kinkou-lifeblade.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import ganking from "../../../../engine-core/dist/effects/keywords/Ganking.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { expandProgram } from "../../../../engine-core/dist/programs/keywords.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.

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
  assert.match(program.judgeReason, /ObjectSnapshot/);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /continuous\.grant-keyword/);
  assert.doesNotMatch(program.judgeReason, /RIFT-91 只合入|没有 .*continuous\.grant-keyword/);
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
  // 828.1.b.1 的门槛读取参考内核 empowered；生产状态契约仍缺。
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
    "'Use only if not Empowered') needs KeywordAbility params.cost and programs/keywords printed-cost forwarding"
);

test.todo(
  "ven-093-166 Kinkou Lifeblade: both [Empowered][>] dependent abilities (828.1.b.1) need an Empowered status " +
    "contract (442.1.a); the merged continuous.might and continuous.grant-keyword primitives " +
    "must then be fed that predicate"
);

test.todo(
  "ven-093-166 Kinkou Lifeblade: the granted [Ganking] still needs the live Empowered gate and keyword rebinding for its " +
    "continuous.movement permission (810.1.c, 144.4.c)"
);

// Resolution-only evidence: no activation or printed-cost payment is claimed.
test("kinkou-lifeblade: the merged Empower resolution body checks live state and does not empower twice", () => {
  const kernel = world().unit("kinkou-lifeblade", { cardId: CANONICAL }).build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("kinkou-lifeblade") });
  const [expanded] = expandProgram(program, context.source).expanded;
  assert.equal(expanded.kind, "activated");
  assert.equal(expanded.timing, "action");
  assert.equal(expanded.body[0].op, "effect.empower");
  assert.deepEqual(expanded.restriction.condition, {
    kind: "compare", left: { kind: "object-property", object: "self", property: "empowered" },
    operator: "eq", right: { kind: "constant", value: 0 }
  });
  const first = runAbilityBody(expanded.body, context, undefined, { host: context.source.ref });
  assert.equal(first.status, "executed");
  assert.equal(context.getObject("kinkou-lifeblade").empowered, 1);
  const second = runAbilityBody(expanded.body, context, undefined, { host: context.source.ref });
  assert.equal(second.results[0].result.reason, "skipped");
  assert.equal(context.getObject("kinkou-lifeblade").empowered, 1);
  assert.deepEqual(context.events.map(event => event.action), ["empower"]);
});



test("kinkou-lifeblade: the actual static binder follows Empower and Disempower for +1 Might", () => {
  const { engine, kernel } = fixture();
  const source = kernel.getObject("source");
  const binder = createEngineStaticBinder(engine);
  const handle = binder.bindStatic(mightGrant, source);
  const keywordHandle = binder.bindStatic(keywordGrant, source);
  assert.equal(engine.layers.evaluate(source.ref).might, 2);
  assert.equal(engine.commit({ type: "empower", object: source.ref }).status, "done");
  engine.advance();
  assert.equal(engine.layers.evaluate(source.ref).might, 3);
  assert.equal(engine.layers.evaluate(source.ref).buffs, 0);
  assert.ok(engine.layers.evaluate(source.ref).keywords.some(keyword => keyword.id === "Ganking"));
  assert.equal(engine.commit({ type: "disempower", object: source.ref }).status, "done");
  engine.advance();
  assert.equal(engine.layers.evaluate(source.ref).might, 2);
  assert.equal(engine.layers.evaluate(source.ref).keywords.some(keyword => keyword.id === "Ganking"), false);
  keywordHandle.unbind();
  handle.unbind();
});

// RIFT-672 execution evidence: ../templates/keyword-static-672.test.mjs (supported paths only).
import assert from "node:assert/strict";
import test from "node:test";
import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/legion-marauder.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { expandProgram } from "../../../../engine-core/dist/programs/keywords.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

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
  assert.match(program.judgeReason, /ObjectSnapshot/);
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
    property: "empowered"
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
    "either-or printed cost (827.1.c.2 'Pay either cost: 1 Energy or 1 Body Power') need the merged Empower KeywordDef " +
    "plus the still-missing card keyword-cost carrier and forwarding"
);
test.todo(
  "ven-074-166 Legion Marauder: the +1 Might half needs an Empowered status contract (442.1.a) and a " +
    "working Empowered gate; the continuous.might primitive and static registration are merged"
);

// Resolution-only evidence: no activation or printed-cost payment is claimed.
test("legion-marauder: the merged Empower resolution body checks live state and does not empower twice", () => {
  const kernel = world().unit("legion-marauder", { cardId: CANONICAL_ID }).build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("legion-marauder") });
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
  assert.equal(context.getObject("legion-marauder").empowered, 1);
  const second = runAbilityBody(expanded.body, context, undefined, { host: context.source.ref });
  assert.equal(second.results[0].result.reason, "skipped");
  assert.equal(context.getObject("legion-marauder").empowered, 1);
  assert.deepEqual(context.events.map(event => event.action), ["empower"]);
});



test("legion-marauder: the actual static binder follows Empower and Disempower for +1 Might", () => {
  const { engine, kernel } = fixture();
  const source = kernel.getObject("source");
  const binder = createEngineStaticBinder(engine);
  const handle = binder.bindStatic(mightBonus, source);
  assert.equal(engine.layers.evaluate(source.ref).might, 2);
  assert.equal(engine.commit({ type: "empower", object: source.ref }).status, "done");
  engine.advance();
  assert.equal(engine.layers.evaluate(source.ref).might, 3);
  assert.equal(engine.layers.evaluate(source.ref).buffs, 0);
  assert.equal(engine.commit({ type: "disempower", object: source.ref }).status, "done");
  engine.advance();
  assert.equal(engine.layers.evaluate(source.ref).might, 2);
  handle.unbind();
});

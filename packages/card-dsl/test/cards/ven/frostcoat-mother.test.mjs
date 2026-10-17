// 场景执行证据与整卡阻塞：../templates/keyword-static-static-649.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/frostcoat-mother.js";
import { createEngineStaticBinder, expandProgram, translateCost } from "../../../../engine-core/dist/programs/index.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

const CANONICAL_ID =
  "card.hash-af86d71346754f5a19f63ebf193cb978f3d3dffe541f342d86bd89ab951eefb8";
const SOURCE_TEXT =
  "[Empower] :rb_energy_12:. This ability costs :rb_energy_1: less for each rune you control. (Pay the cost: Empower me. Use only if not Empowered.)\n" +
  "[Empowered][>] I have +3 :rb_might:.";

const [empower, costReduction, might] = program.abilities;

test("ven-032-166 Frostcoat Mother: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("ven-032-166 Frostcoat Mother: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /827\.1\.c\.1/);
  assert.match(program.judgeReason, /827\.1\.c\.3/);
  assert.match(program.judgeReason, /Empowered/);
  assert.match(program.judgeReason, /expandProgram/);
  assert.match(program.judgeReason, /appliesTo/);
  assert.match(program.judgeReason, /费用消费方/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("ven-032-166 Frostcoat Mother: [Empower] carries the printed 12 Energy and no invented activation", () => {
  // 827.1.c.1: the activation, its cost rewrite and its restriction belong to the
  // keyword layer, so the card only declares the printed keyword value.
  assert.deepEqual(empower, { kind: "keyword", keyword: "empower", value: 12 });
  assert.equal(program.abilities.some(ability => ability.kind === "activated"), false);
});

test("ven-032-166 Frostcoat Mother: 'costs 1 less for each rune you control' is a rewrite of that Empower activation", () => {
  // 827.1.c.3 / 206.1: the clause is part of determining the Empower cost, not an
  // independent effect; 133.5.a.1 / 431.1 make the count the controller's runes.
  assert.equal(costReduction.kind, "static");
  assert.deepEqual(costReduction.effect, {
    kind: "continuous.cost-modification",
    resource: "energy",
    appliesTo: "empower-activation-cost",
    per: "rune-you-control",
    minimum: 0,
    amount: {
      kind: "arithmetic",
      operator: "neg",
      operands: [{
        kind: "count",
        subject: "runes",
        filter: { type: "rune", controller: "self", zone: "rune-zone" }
      }]
    }
  });
  assert.equal(costReduction.condition, undefined);
});

test("ven-032-166 Frostcoat Mother: the [Empowered][>] dependent ability is +3 Might to self", () => {
  // 828.1.b.1 / 143.2.a: the bonus lives in the arithmetic layer while the host is Empowered.
  assert.equal(might.kind, "static");
  assert.deepEqual(might.effect, {
    kind: "continuous.might",
    mode: "add",
    layer: "arithmetic",
    appliesTo: "self",
    amount: { kind: "constant", value: 3 }
  });
  assert.deepEqual(might.condition, {
    kind: "compare",
    left: { kind: "object-property", object: "self", property: "empowered" },
    operator: "gte",
    right: { kind: "constant", value: 1 }
  });
});

test("ven-032-166 Frostcoat Mother: merged Empower expands, but the printed cost cannot cross the card-program boundary", () => {
  const { source } = hostFor(program, "frostcoat");
  const expanded = expandProgram(program, source);
  const [expandedEmpower] = expanded.expanded;
  assert.equal(expandedEmpower.kind, "activated");
  assert.deepEqual(expandedEmpower.cost, { kind: "empower" });
  assert.deepEqual(expandedEmpower.restriction.condition, {
    kind: "compare",
    left: { kind: "object-property", object: "self", property: "empowered" },
    operator: "eq",
    right: { kind: "constant", value: 0 }
  });
  assert.throws(
    () => translateCost(expandedEmpower.cost, "frostcoat.empower", "activate"),
    /Unsupported cost kind empower/
  );
});

test.todo(
  "ven-032-166 Frostcoat Mother: integrate printed Empower cost and production state (827.1.c.1, 442.1); static subset is covered in the template"
);

/** 复核（2026-10-17）负向证据：关键词展开与减费静态绑定两处缺口。 */
function hostFor(programUnderTest, id) {
  const f = fixture({ cards: [{ id, cardId: programUnderTest.canonicalCardId, types: ["unit"], might: 3 }] });
  f.engine.commit({ type: "move-zone", object: f.kernel.ref(id), to: "base" });
  return { f, source: f.kernel.getObject(id) };
}

test("ven-032-166 Frostcoat Mother evidence: the cost modification stays blocked while the corrected Empowered gate follows live state", () => {
  const { f, source } = hostFor(program, "frostcoat");
  const binder = createEngineStaticBinder(f.engine);
  // 827.1.c.3：减费声明要作为 Empower 启动费用的改写被消费；当前 staticTarget 直接失败关闭。
  assert.throws(
    () => binder.bindStatic(costReduction, source),
    /Unsupported static appliesTo "empower-activation-cost"/
  );
  // 828.1.b.1：直接绑定原始 static；状态由真实动作改变，不以常量字符串开启。
  const handle = binder.bindStatic(might, source);
  f.engine.layers.setObjects(f.kernel.objects);
  assert.equal(f.engine.layers.evaluate(f.kernel.ref("frostcoat")).might, 3);
  assert.equal(f.engine.commit({ type: "empower", object: source.ref }).status, "done");
  f.engine.layers.setObjects(f.kernel.objects);
  assert.equal(f.engine.layers.evaluate(source.ref).might, 6);
  assert.equal(f.engine.commit({ type: "disempower", object: source.ref }).status, "done");
  f.engine.layers.setObjects(f.kernel.objects);
  assert.equal(f.engine.layers.evaluate(source.ref).might, 3);
  handle.unbind();
  f.engine.layers.setObjects(f.kernel.objects);
  assert.equal(f.engine.layers.evaluate(f.kernel.ref("frostcoat")).might, 3);
});

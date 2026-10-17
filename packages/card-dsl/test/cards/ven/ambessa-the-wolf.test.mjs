import assert from "node:assert/strict";
import { expandProgram } from "../../../../engine-core/dist/programs/keywords.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/ambessa-the-wolf.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL =
  "card.hash-e8452b3b9f2d2d608a43289045ddea899510d5650e10a3ffaf7066b5484d0f49";
const SOURCE_TEXT =
  "[Empower] :rb_energy_3::rb_rune_body: (:rb_energy_3::rb_rune_body:: Empower me. " +
  "Use only if not Empowered.)\n" +
  "[Empowered][>] I have +3 :rb_might: and can't be dealt damage unless I'm in combat.";

const [empower, mightGrant, damagePrevention] = program.abilities;

test("ven-084-166 Ambessa, The Wolf: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("ven-084-166 Ambessa: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
  assert.match(program.judgeReason, /Empower/);
  assert.match(program.judgeReason, /828\.1\.b\.1/);
  assert.match(program.judgeReason, /438\.7/);
  assert.match(program.judgeReason, /ObjectSnapshot/);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /bindReplacement/);
  assert.match(program.judgeReason, /combatRole/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("ven-084-166 Ambessa: [Empower] 3 Energy + 1 Body Power stays a keyword declaration", () => {
  assert.deepEqual(empower, { kind: "keyword", keyword: "empower" });
  // 827.1.c.1 的费用与“仅当未 Empowered 时”限制属于 KeywordDef 的展开
  //（README 第 5 节：卡文件只声明关键词身份，不自己重写展开）；展开依赖见 judgeReason。
  assert.equal(empower.value, undefined);
});

test("ven-084-166 Ambessa: the Empowered +3 Might is an arithmetic-layer modification, not a Buff (479.4.e.1)", () => {
  assert.equal(mightGrant.kind, "static");
  assert.equal(mightGrant.effect.kind, "continuous.might");
  assert.equal(mightGrant.effect.mode, "add");
  assert.equal(mightGrant.effect.layer, "arithmetic");
  assert.equal(mightGrant.effect.appliesTo, "self");
  assert.deepEqual(mightGrant.effect.amount, { kind: "constant", value: 3 });
  // 828.1.b.1 的依赖门槛读取真实 empowered 计数。
  assert.equal(mightGrant.condition.kind, "compare");
  assert.deepEqual(mightGrant.condition.left, {
    kind: "object-property",
    object: "self",
    property: "empowered"
  });
  assert.equal(mightGrant.condition.operator, "gte");
  assert.deepEqual(mightGrant.condition.right, { kind: "constant", value: 1 });
});

test("ven-084-166 Ambessa: 'can't be dealt damage unless I'm in combat' is a damage-prevention replacement", () => {
  // 369.1 的 would/instead 标识替代效果；438.7 说明 Prevent 是 Delayed Replacement Effect。
  assert.equal(damagePrevention.kind, "replacement");
  assert.deepEqual(damagePrevention.replaces, {
    event: "damage",
    filter: { target: "self", characteristics: { combatRole: null } }
  });
  // 空 with = 伤害事件被替换为“什么也不发生”（同 ogn/kayn-unleashed 的写法）。
  assert.deepEqual(damagePrevention.with, []);
  assert.equal(damagePrevention.condition.kind, "compare");
  assert.equal(damagePrevention.condition.operator, "gte");
  assert.deepEqual(damagePrevention.condition.right, { kind: "constant", value: 1 });
});

test("ven-084-166 golden: continuous.might really adds +3 Might through the merged primitive (RIFT-258)", () => {
  // [Empowered][>] I have +3 :rb_might:. - the primitive itself is merged
  // (RIFT-258); the original gated static is exercised separately below.
  // This golden runs the card's own static effect shape through the real
  // interpreter + test kernel, then projects through the layers engine.
  const kernel = world()
    .unit("ambessa-the-wolf", { controller: "A", might: 4 })
    .build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("ambessa-the-wolf") });
  const body = [{
    id: "ambessa-the-wolf.grant-might",
    op: "continuous.might",
    args: {
      mode: { kind: "constant", value: mightGrant.effect.mode },
      amount: mightGrant.effect.amount,
      appliesTo: { kind: "constant", value: "self" }
    }
  }];
  const outcome = resolveChainBody(body, context);
  assert.equal(outcome.status, "executed");
  assert.equal(context.continuousEffects.length, 1);
  assert.equal(context.continuousEffects[0].effect.layer, "arithmetic");
  assert.deepEqual(context.continuousEffects[0].effect.effect.amount, 3);

  const layers = createLayerEngine(context.objects, context.continuousEffects.map((entry, index) => ({
    effect: entry.effect,
    duration: entry.duration,
    timestamp: index + 1
  })));
  assert.equal(layers.evaluate(context.ref("ambessa-the-wolf")).might, 7);
});

test.todo(
  "ven-084-166 Ambessa: bind printed 3 Energy + 1 Body Power through KeywordAbility.params.cost and expandProgram (827.1.c.1)"
);

test.todo(
  "ven-084-166 Ambessa: integrate live empowered static/replacement gates with authoritative binary state and activation (442.1.a-c / 828.1.b.1)"
);

test.todo(
  "ven-084-166 Ambessa: combat-start transaction must write attacker/defender combatRole before evaluating the 438.7 prevention exception (466.2)"
);

// The card remains judge-required: this binds only its supported static clause.
// State changes use real actions; the original static ability is never rewritten.
test("ambessa-the-wolf: the dependent static follows live Empower and Disempower actions", () => {
  const { kernel, engine } = fixture({ cards: [{
    id: "host", cardId: program.canonicalCardId, types: ["unit"],
    might: 4, energy: null, power: null
  }] });
  assert.equal(engine.commit({
    type: "move-zone", object: kernel.ref("host"), to: "battlefield",
    location: { type: "battlefield", id: "bf-gate" }
  }).status, "done");
  const binding = createEngineStaticBinder(engine).bindStatic(mightGrant, kernel.getObject("host"));
  let snapshot = engine.layers.snapshot(kernel.ref("host"));
  assert.equal(snapshot.might, 4);
  assert.equal(snapshot.energy, null);
  assert.equal(snapshot.power, null);

  assert.equal(engine.commit({ type: "empower", object: kernel.ref("host") }).status, "done");
  snapshot = engine.layers.snapshot(kernel.ref("host"));
  assert.equal(snapshot.empowered, 1);
  assert.equal(snapshot.might, 7);

  assert.equal(engine.commit({ type: "disempower", object: kernel.ref("host") }).status, "done");
  snapshot = engine.layers.snapshot(kernel.ref("host"));
  assert.equal(snapshot.empowered, 0);
  assert.equal(snapshot.might, 4);
  assert.deepEqual(engine.pipeline.events.filter(event => event.timingPoint === "empowered-changed")
    .map(event => event.action.type), ["empower", "disempower"]);
  binding.unbind();
});

test("ambessa-the-wolf: the merged Empower definition expands through the real program adapter", () => {
  const kernel = world().unit("keyword-host", {
    cardId: program.canonicalCardId, energy: null, power: null
  }).build();
  const { expanded } = expandProgram(program, kernel.getObject("keyword-host"));
  assert.equal(expanded.length, 1);
  const [activation] = expanded;
  assert.equal(activation.kind, "activated");
  assert.equal(activation.timing, "action");
  // The missing printed-cost bridge must never turn this into a free activation.
  assert.deepEqual(activation.cost, { kind: "empower" });
  assert.deepEqual(activation.restriction, { kind: "empower", condition: {
    kind: "compare",
    left: { kind: "object-property", object: "self", property: "empowered" },
    operator: "eq", right: { kind: "constant", value: 0 }
  } });
  assert.equal(activation.body[0].id, `empower:${program.canonicalCardId}`);
  assert.equal(activation.body[0].op, "effect.empower");
  assert.deepEqual(activation.body[0].args, { amount: { kind: "constant", value: 1 } });
  assert.deepEqual(activation.body[0].condition, activation.restriction.condition);
  assert.equal(activation.body[0].targets, undefined);
  assert.equal(program.status, "judge-required");
});

test("ven-084-166 Ambessa: the actual replacement prevents damage only while Empowered outside combat", () => {
  const { kernel, engine } = fixture({ cards: [{
    id: "wolf", cardId: program.canonicalCardId, types: ["unit"], might: 4,
    energy: null, power: null
  }] });
  assert.equal(engine.commit({
    type: "move-zone", object: kernel.ref("wolf"), to: "battlefield",
    location: { type: "battlefield", id: "bf-prevention" }
  }).status, "done");
  const binding = createEngineStaticBinder(engine).bindReplacement(damagePrevention, kernel.getObject("wolf"));
  const hit = () => engine.commit({
    type: "damage", source: kernel.ref("enemy"), target: kernel.ref("wolf"), amount: 1
  });
  assert.equal(hit().status, "done");
  assert.equal(kernel.getObject("wolf").damage, 1);
  assert.equal(engine.commit({ type: "empower", object: kernel.ref("wolf") }).status, "done");
  assert.equal(hit().status, "replaced");
  assert.equal(kernel.getObject("wolf").damage, 1);
  assert.equal(engine.commit({ type: "disempower", object: kernel.ref("wolf") }).status, "done");
  assert.equal(hit().status, "done");
  assert.equal(kernel.getObject("wolf").damage, 2);
  assert.equal(engine.pipeline.events.filter(event => event.timingPoint === "damage-dealt").length, 2);
  binding.unbind();
});

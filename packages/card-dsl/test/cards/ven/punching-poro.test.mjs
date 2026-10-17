// RIFT-672 execution evidence: ../templates/keyword-static-672.test.mjs (supported paths only).
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createActionPipelineHost, bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/punching-poro.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";

const CARD_ID =
  "card.hash-4e84bd06baa7f0981211f77e8859b781d223544ea2429070561399db373e5c6f";
const SOURCE_TEXT =
  "[Empower] — Discard 1 (Pay the cost: Empower me. Use only if not Empowered.)\n" +
  "[Empowered][>] I have +1 :rb_might:.";

const [empower, might] = program.abilities;

test("ven-007-166 Punching Poro: program validates and is registered by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("ven-007-166 Punching Poro: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  // judgeReason 必须点名 Empower、discard 费用与图层门控的真实缺口。
  assert.match(program.judgeReason, /Empower/);
  assert.match(program.judgeReason, /827\.1\.c\.1/);
  assert.match(program.judgeReason, /827\.1\.c\.2/);
  assert.match(program.judgeReason, /discard/);
  assert.match(program.judgeReason, /empowered/);
  assert.match(program.judgeReason, /params\.cost/);
  assert.match(program.judgeReason, /ObjectSnapshot/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("ven-007-166 Punching Poro: [Empower] is declared as a keyword ability without a rewritten expansion", () => {
  // 827.1.c 的印刷费用是「Discard 1」；827.1.c.2 允许非资源费用。
  // 契约 3.1 的 KeywordAbility 只有 keyword / value，无法承载非数值印刷费用，因此
  // 卡文件只声明关键词身份（见回复的契约变更请求），不伪造 value 也不手写展开。
  assert.deepEqual(empower, { kind: "keyword", keyword: "empower" });
  assert.equal(empower.value, undefined);
  assert.equal(empower.params, undefined);
});

test("ven-007-166 Punching Poro: the Empowered dependent ability is a gated +1 Might static effect", () => {
  // 828.1.b.1：等价于「持有 Empowered 时本牌获得 '+1 Might'」。
  assert.equal(might.kind, "static");
  assert.deepEqual(might.effect, {
    kind: "continuous.might",
    mode: "add",
    layer: "arithmetic",
    appliesTo: "self",
    amount: { kind: "constant", value: 1 }
  });
  // 143.2.a/475–477 的算术图层修正；不是 Buff 计数（702/703）。
  assert.notEqual(might.effect.kind, "effect.buff");
  // 828.1.c 的门控读取来源当前 Empowered 状态。
  assert.deepEqual(might.condition, {
    kind: "compare",
    left: { kind: "object-property", object: "self", property: "empowered" },
    operator: "gte",
    right: { kind: "constant", value: 1 }
  });
  // 不把依赖能力写成无条件能力：条件必须存在。
  assert.notEqual(might.condition.kind, "always");
});

test.todo(
  "ven-007-166 Punching Poro: activate [Empower] by discarding 1 card (827.1.c.1 / 827.1.c.2) with the " +
    "'use only if not Empowered' restriction — Empower KeywordDef exists; KeywordAbility and programs/keywords.ts need " +
    "params.cost forwarding and symbolic hand-pick binding (the discard component exists in cost/plan-values.ts but no module " +
    "reads the card program's Empower cost)"
);

test("ven-007-166 Punching Poro golden: the declared +1 Might really applies in the merged layers", () => {
  // The static → layers binding entry point is merged (programs/statics.ts
  // createEngineStaticBinder, RIFT-91 batch). This golden executes the card's
  // own declared arithmetic effect in the merged layer engine; the 828.1.c
  // Empowered condition is covered through the real static binder below; the
  // full keyword cost binding remains judge-required.
  const host = {
    ref: { id: "punching-poro", zoneEntryId: 1 },
    name: "Punching Poro",
    types: ["unit"],
    tags: [],
    keywords: [],
    owner: "A",
    controller: "A",
    zone: "board",
    location: { type: "base", player: "A" },
    might: 2,
    energy: 2,
    power: ["Fury"],
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: false
  };
  const engine = createLayerEngine([host], [{
    effect: {
      id: "punching-poro.empowered-might",
      layer: might.effect.layer,
      filter: { type: "unit", controller: "A", zone: "board" },
      effect: might.effect
    },
    duration: { type: "permanent" },
    timestamp: 1
  }]);
  engine.setObjects([host]);

  assert.equal(engine.evaluate(host.ref).might, 3);
  assert.equal(engine.evaluate(host.ref).printed.might, 2);
});

test("ven-007-166 Punching Poro regression: the original static gate follows real Empower/Disempower actions", () => {
  const { kernel, engine } = staticFixture([
    { id: "poro", cardId: CARD_ID, types: ["unit"], zone: "board", might: 2, power: null }
  ]);
  const source = kernel.getObject("poro");
  createEngineStaticBinder(engine).bindStatic(might, source);
  assert.equal(engine.layers.snapshot(source.ref).might, 2, "dependent ability is inactive before Empower");
  assert.equal(engine.commit({ type: "empower", object: source.ref }).status, "done");
  assert.equal(engine.layers.snapshot(source.ref).might, 3, "the real state activates the dependent ability");
  assert.equal(engine.layers.snapshot(kernel.ref("source")).might, 2, "the bonus is self only");
  assert.equal(engine.commit({ type: "disempower", object: source.ref }).status, "done");
  assert.equal(engine.layers.snapshot(source.ref).might, 2, "dependent ability ends immediately");
  assert.equal(kernel.getObject("poro").power, null);
});


function staticFixture(cards) {
  const builder = world().player("A", { energy: 20 }).player("B", { energy: 20 })
    .unit("source", { might: 2, location: { type: "base", player: "A" } })
    .unit("enemy", { owner: "B", might: 5, location: { type: "base", player: "B" } });
  for (const card of cards) builder.object(card.id, { location: { type: "base", player: "A" }, ...card });
  const kernel = builder.build();
  const host = createActionPipelineHost({
    checkpoint: () => kernel.snapshot(), restore: state => kernel.restore(state),
    objects: () => kernel.objects, perform: action => kernel.perform(action),
    choose: request => kernel.choose(request),
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint })
  });
  const engine = new ChainEngine({ host, turnOrder: ["A", "B"], turnPlayer: "A", cleanup: engine => {
    engine.layers.setObjects(kernel.objects);
    let changed = false;
    for (const object of engine.layers.evaluateAll()) {
      if (object.zone === "board" && object.types.includes("unit") && object.might !== null &&
          (object.might <= 0 || object.damage >= object.might)) {
        changed = engine.commit({ type: "kill", object: object.ref }).status === "done" || changed;
      }
    }
    return changed;
  } });
  return { kernel, engine };
}

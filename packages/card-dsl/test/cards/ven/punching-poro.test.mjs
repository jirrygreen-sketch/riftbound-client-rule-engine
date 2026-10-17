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
  assert.match(program.judgeReason, /RIFT-89/);
  assert.match(program.judgeReason, /RIFT-91/);
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
  // 828.1.c 的门控用显式谓词占位，不手写状态判定。
  assert.deepEqual(might.condition, {
    kind: "expression",
    value: { kind: "constant", value: "empowered" }
  });
  // 不把依赖能力写成无条件能力：条件必须存在。
  assert.notEqual(might.condition.kind, "always");
});

test.todo(
  "ven-007-166 Punching Poro: activate [Empower] by discarding 1 card (827.1.c.1 / 827.1.c.2) with the " +
    "'use only if not Empowered' restriction — needs the Empower/Empowered KeywordDef and the " +
    "RIFT-89 cost-plan wiring (the discard component exists in cost/plan-values.ts but no module " +
    "reads the card program's Empower cost)"
);

test("ven-007-166 Punching Poro golden: the declared +1 Might really applies in the merged layers", () => {
  // The static → layers binding entry point is merged (programs/statics.ts
  // createEngineStaticBinder, RIFT-91 batch). This golden executes the card's
  // own declared arithmetic effect in the merged layer engine; the 828.1.c
  // Empowered gate stays judged (see judgeReason), so the program itself must
  // not run as an unconditional ability.
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

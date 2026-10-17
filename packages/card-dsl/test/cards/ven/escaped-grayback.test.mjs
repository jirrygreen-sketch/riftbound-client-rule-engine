import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/escaped-grayback.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { payCostPlan } from "../../../../engine-core/dist/cost/payment.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { expandProgram } from "../../../../engine-core/dist/programs/index.js";

const CANONICAL_ID =
  "card.hash-873c8f0234994082b765c3eb70f58d38ed667f83edf9a43739a2a1f28910a0f5";
const SOURCE_TEXT =
  "[Empower] — Kill a friendly unit (Pay the cost: Empower me. Use only if not Empowered.)\n" +
  "[Empowered][>] I have +2 :rb_might:.";

const [empower, mightGrant] = program.abilities;

test("ven-124-166 Escaped Grayback: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("ven-124-166 Escaped Grayback: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /Empower/);
  assert.match(program.judgeReason, /827\.1\.c\.2/);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /Empowered/);
  assert.match(program.judgeReason, /expandProgram/);
  assert.match(program.judgeReason, /conditionMatches/);
});

test("ven-124-166 Escaped Grayback: [Empower] is declared as a keyword whose cost is a Kill", () => {
  assert.equal(program.abilities.length, 2);
  // 827.1.c / 827.1.c.1 / 827.1.c.2："Empower — Kill a friendly unit" 的功能等价文本是
  // 「[Kill 一个友方单位]：Empower 我，仅当未 Empowered 时启动」；非资源费用分量由关键词
  // 展开承载，卡文件只声明关键词（KeywordAbility 没有 params 字段）。
  assert.deepEqual(empower, { kind: "keyword", keyword: "empower" });
  assert.equal(empower.value, undefined);
  assert.equal(empower.params, undefined);
});

test("ven-124-166 Escaped Grayback: the [Empowered] dependent clause grants +2 Might to self", () => {
  // 828.1.b.1：整段【Empowered】能力功能等价于“当我拥有 Empowered 状态时，此牌获得 [Text]”。
  assert.equal(mightGrant.kind, "static");
  assert.equal(mightGrant.effect.kind, "continuous.might");
  assert.equal(mightGrant.effect.mode, "add");
  assert.equal(mightGrant.effect.layer, "arithmetic");
  assert.equal(mightGrant.effect.appliesTo, "self");
  assert.deepEqual(mightGrant.effect.amount, { kind: "constant", value: 2 });
  // 442.1.a 的 Empowered 状态没有可求值谓词：用显式谓词字符串占位。
  assert.deepEqual(mightGrant.condition, {
    kind: "expression",
    value: { kind: "constant", value: "empowered" }
  });
  // 143.2.a / 475-477：+2 是算术图层修正，绝不是 702 的 Buff 计数。
  assert.equal(mightGrant.effect.buffs, undefined);
});

test("ven-124-166 Escaped Grayback golden: the Empower cost's Kill is a payable nonstandard component", () => {
  // 827.1.c.2：Empower 费用可同时含资源与非资源分量；已合入的费用计划支持
  // kind: "kill"（cost/plan-values.ts 的 nonstandard cost）。这里用该卡印刷的
  // 「Kill a friendly unit」形状构造费用，证明确实作为付费动作被收集。
  const base = world()
    .player("controller")
    .unit("grayback", { controller: "controller", might: 3 })
    .unit("friendly-fodder", { controller: "controller", might: 1 })
    .build();
  const kernel = base.clone({ controller: "controller" });
  const plan = buildCostPlan(kernel, {
    id: "escaped-grayback.empower",
    cost: {
      kind: "explicit",
      energy: { kind: "constant", value: 0 },
      payments: [
        {
          kind: "kill",
          amount: { kind: "constant", value: 1 },
          object: kernel.ref("friendly-fodder")
        }
      ]
    },
    domains: ["Order"]
  });
  assert.deepEqual(plan.total.actions.map((entry) => entry.action.type), ["kill"]);
  assert.deepEqual(plan.total.actions[0].action.object, kernel.ref("friendly-fodder"));
});

test("ven-124-166 Escaped Grayback golden: the declared +2 Might produces an arithmetic-layer bonus", () => {
  // RIFT-91 的 layers 引擎已合入求值侧：用该卡声明的 amount/appliesTo 形状做真实求值。
  // 它不证明 Empowered 门控或卡牌注册已接通（见 judgeReason）。
  const kernel = world()
    .unit("grayback", {
      controller: "controller",
      might: 3,
      types: ["unit"],
      location: { type: "base", player: "controller" }
    })
    .build()
    .clone({ controller: "controller" });
  const snapshot = kernel.getObject("grayback");
  const engine = createLayerEngine([snapshot], [
    {
      effect: {
        id: "escaped-grayback.might",
        layer: "arithmetic",
        source: snapshot.ref,
        filter: { objectId: "grayback" },
        effect: {
          kind: "continuous.might",
          mode: mightGrant.effect.mode,
          amount: mightGrant.effect.amount
        }
      },
      duration: { type: "permanent" },
      timestamp: 1,
      sequence: 1
    }
  ]);
  assert.equal(engine.evaluate(snapshot.ref).might, 5);
});

test.todo(
  "ven-124-166 Escaped Grayback: [Empower] expansion (827.1.c.1: '[Kill a friendly unit]: Empower me, use " +
    "only if not Empowered') and its activation wiring — no Empower/Empowered KeywordDef is available and " +
    "the keyword expansion does not yet consume the declared nonstandard Kill cost"
);

test.todo(
  "ven-124-166 Escaped Grayback: the [Empowered] dependent +2 Might reaches the layers behind the " +
    "Empowered status gate (CR 828.1.b.1 / 442.1.a) — no Empowered predicate exists"
);

// 2026-10-17 RIFT-618: deleted the stale "expandProgram rejects the missing Empower KeywordDef"
// assertion — effects/keywords/Empower.ts is merged, so that absence claim is no longer true.

test("ven-124-166 Escaped Grayback evidence: the Kill cost really pays through the merged cost pipeline", () => {
  // 827.1.c.2：Kill 是非资源费用分量；费用种类本身已合入，缺口只在关键词展开未携带它。
  const base = world()
    .player("controller")
    .unit("grayback", { controller: "controller", might: 3 })
    .unit("friendly-fodder", { controller: "controller", might: 1 })
    .build();
  const kernel = base.clone({ controller: "controller" });
  const plan = buildCostPlan(kernel, {
    id: "escaped-grayback.empower",
    cost: {
      kind: "explicit",
      energy: { kind: "constant", value: 0 },
      payments: [{ kind: "kill", amount: { kind: "constant", value: 1 }, object: kernel.ref("friendly-fodder") }]
    },
    domains: ["Order"]
  });
  const receipt = payCostPlan(kernel, plan);
  assert.equal(receipt.paid, true);
  assert.deepEqual(receipt.actions.map((entry) => [entry.action.type, entry.status]), [["pay", "done"], ["kill", "done"]]);
  // 429.6：被作为费用的友方单位确实进入其拥有者的 Trash。
  assert.equal(kernel.getObject("friendly-fodder").zone, "trash");
  assert.deepEqual(kernel.events.map((event) => event.action), ["pay", "kill"]);
});

test("ven-124-166 Escaped Grayback evidence: the Empowered condition string is not recognized by the layer engine", () => {
  // 442.1.a/828.1.b.1：没有 Empowered 谓词时 layers/engine.ts 的 conditionMatches 对未知 kind 返回 true，
  // 未 Empowered 的宿主也会拿到 +2；程序不把它当作已门控效果，故整卡保持 judge-required。
  const kernel = world()
    .unit("grayback", { controller: "controller", might: 3, types: ["unit"], location: { type: "base", player: "controller" } })
    .build()
    .clone({ controller: "controller" });
  const snapshot = kernel.getObject("grayback");
  const engine = createLayerEngine([snapshot], [{
    effect: {
      id: "escaped-grayback.might",
      layer: "arithmetic",
      source: snapshot.ref,
      filter: { objectId: "grayback" },
      effect: {
        kind: "continuous.might",
        mode: "add",
        amount: { kind: "constant", value: 2 },
        condition: { kind: "expression", value: { kind: "constant", value: "empowered" } }
      }
    },
    duration: { type: "permanent" },
    timestamp: 1,
    sequence: 1
  }]);
  assert.equal(engine.evaluate(snapshot.ref).might, 5, "unempowered host still gets +2 with the authored placeholder condition");
});

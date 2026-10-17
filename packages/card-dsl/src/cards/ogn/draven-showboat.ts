import type { CardProgram } from "../../ir/index.js";

/**
 * Draven, Showboat (ogn-028-298) — Unit, Fury, Draven/Noxus/Champion.
 * energy 5, power 1 (Fury), Might 3.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, ogn-028-298):
 *   "My Might is increased by your points."
 *
 * 规则依据（CR v1.5）：
 * - 194/194.4：points 是玩家状态（PlayerSnapshot.score 为已有点数），
 *   "your points" 指本卡控制者的当前点数。
 * - "My Might is increased by your points." 是静态（Passive）持续能力：一个
 *   在 arithmetic 图层按控制者当前点数给本单位加 Might 的 continuous.might
 *   效果，取值在图层计算时动态求值（不是进场或结算时锁定）。
 *
 * status：judge-required。玩家状态表达式已经合入，故金额改为正式的
 * `player-property(points)`；2026-10-17 实测静态 continuous.might 仍经真实
 * attachLifecycle 注册成功（图层注册数 1），但生产静态绑定会把该表达式原样交给
 * LayerEngine，后者的 valueOf 不调用 expr-ext/evaluate.ts，遇到 player-property
 * 会按 0 处理。把玩家 A 的点数设为 3 后 evaluate 出的 Might 仍是印刷值 3（期望 6）。
 * 不近似成固定数值；表达式本身可校验，但消费方尚未接线。
 */
const dravenShowboat = {
  canonicalCardId: "card.hash-2fce7f4e1db0ed6a111d74a7702d3846593794a9cddf1a1722959543f53ec58e",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "continuous.might 仍缺「按控制者当前点数动态加 Might」的生产消费链（CR 194/194.1）：" +
    "EffectIR 已能用 player-property(points) 读取 PlayerSnapshot.score，但 programs/statics.ts " +
    "的静态绑定会把该表达式原样交给 layers/engine.ts；LayerEngine.valueOf 未接入 " +
    "effects/interpreter/expr-ext/evaluate.ts，player-property 会落到 0。实测：图层注册成功，" +
    "控制者 3 点时 evaluate 出的 Might 仍是 3（期望 6），点数变化也不会重算。" +
    "不近似为固定 Might 数值；依赖生产静态 binder/LayerEngine 的动态表达式接线。",
  abilities: [
    {
      kind: "static",
      effect: {
        kind: "continuous.might",
        mode: "add",
        layer: "arithmetic",
        appliesTo: "self",
        // CR 194/194.1: the amount is the controller's current points. The
        // player-state expression is valid IR; production LayerEngine wiring
        // still needs to consume it dynamically.
        amount: { kind: "player-property", player: "controller", property: "points" }
      }
    }
  ],
  sourceText: "My Might is increased by your points."
} satisfies CardProgram;

export default dravenShowboat;

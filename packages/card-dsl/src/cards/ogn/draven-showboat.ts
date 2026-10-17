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
 * status：judge-required。2026-10-17 实测：静态 continuous.might 经真实 attachLifecycle
 * 注册成功（图层注册数 1），但 amountFrom 只是描述性数据，不是可执行表达式——
 * 把玩家 A 的点数设为 3 后 evaluate 出的 Might 仍是印刷值 3（期望 6）。
 * 缺口具体为：Expr 没有读取 PlayerSnapshot.score（=194 的 points）的形式，
 * layers/engine.ts 的 valueOf 也只解析 constant/literal、object-property/object-attribute、
 * ref 与 add/subtract/multiply，ObjectSnapshot 本身不含 points。
 * 不近似成固定数值；因此本程序保留开放形状与金额来源描述（amountFrom 不可执行）。
 */
const dravenShowboat = {
  canonicalCardId: "card.hash-2fce7f4e1db0ed6a111d74a7702d3846593794a9cddf1a1722959543f53ec58e",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "continuous.might 缺少「按控制者当前点数动态加 Might」的 amount 表达（CR 194/194.1）：" +
    "Expr 没有读取 PlayerSnapshot.score（points）的形式，ObjectSnapshot 也不含 points，" +
    "layers/engine.ts 的 valueOf 只解析 constant/literal、object-property/object-attribute、ref 与 add/subtract/multiply。" +
    "实测：图层注册成功，但控制者 3 点时 evaluate 出的 Might 仍是 3（期望 6）。" +
    "Amount 无法写成「= your points」；不近似为固定 Might 数值（amountFrom 仅描述性数据）。",
  abilities: [
    {
      kind: "static",
      effect: {
        kind: "continuous.might",
        mode: "add",
        layer: "arithmetic",
        appliesTo: "self",
        // 描述性取值来源（不可执行数据）：amount 应为控制者当前 points。
        amountFrom: { player: "controller", property: "points" }
      }
    }
  ],
  sourceText: "My Might is increased by your points."
} satisfies CardProgram;

export default dravenShowboat;

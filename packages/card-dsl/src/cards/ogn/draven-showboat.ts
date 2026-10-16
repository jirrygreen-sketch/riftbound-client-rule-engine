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
 * status：judge-required。缺两样：
 * 1. 表白达式没有读取玩家属性的形式（Expr 只有 constant / object-property /
 *    linked / count / arithmetic，ObjectSnapshot 也不含 points），无法写出
 *    "amount = 控制者点数"；
 * 2. 改成静态 continuous.might 后仍需 CardProgram 适配器把静态效果登记进 layers/，
 *    卡程序本身不能直接改 Might。
 * 因此本程序只按开放形状声明 effect 与取值来源描述（amountFrom 是描述性数据，
 * 不是可执行表达式），不近似成固定数值。
 */
const dravenShowboat = {
  canonicalCardId: "card.hash-2fce7f4e1db0ed6a111d74a7702d3846593794a9cddf1a1722959543f53ec58e",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺「按控制者当前点数动态加 Might」的表达与消费：Expr 没有读取玩家属性的形式（ObjectSnapshot 也没有 points），" +
    "Amount 无法写成「= your points」；同时静态 continuous.might 还需要 CardProgram 适配器登记进 arithmetic 图层。" +
    "依赖：RIFT-257（CardProgram 绑定）与 PlayerSnapshot/Expr 的 points 读取扩展；" +
    "不近似为固定 Might 数值。",
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

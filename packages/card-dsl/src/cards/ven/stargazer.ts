import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Stargazer (ven-098-166) — Unit, Chaos, tag Mount Targon.
 * 5 Energy, no printed Power（`power: null`，不是 0），Might 4。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-098-166，逐字）：
 *   Spells with [Flow] you play from your trash cost :rb_energy_2: less, to a minimum of
 *   :rb_energy_1:.
 *
 * 规则依据（Core Rules v1.5）：
 * - 366.2 / 366.2.a：“Spells … cost [X] less” 是改费被动能力，在能打出该牌的任意区域生效；
 *   356.4 / 356.4.b 把它放在费用计划的减费阶段，356.4.c/.d 区分“只作用于某个组件”与
 *   “作用于总费用”的折扣，356.4.e 明确带最低值的折扣只约束该折扣自身（因此 minimum 是这条
 *   折扣自己的地板，不是总费用地板）。
 * - 829.1.c：​[Flow] 关键词的印刷费用与“从垃圾场打出”由 Flow 的展开（effects/keywords/
 *   Flow.ts 的 flow.cost，sourceZone: "trash"）声明；“带 [Flow] 的、你从垃圾场打出的法术”
 *   就是本条减费的门槛。
 * - 206：判定费用时使用印刷费用；折扣只在支付时生效。
 *
 * 复核（2026-10-17，第二轮 M2 覆盖率复核）：cost.modify 原语已合入
 * （effects/instructions/cost.modify.ts，reduce/increase、minimum、356.4 语义，
 * 产出冻结费用计划链接），旧缺口「没有 cost.modify 原语」已过时；-2/minimum 的
 * 费用计划 golden 已真实执行。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required。两处当前真实缺口都不近似实现：
 * 1. 没有任何已合入路径把 CardProgram 的 static continuous.cost-modification 安装到
 *    被施放法术的费用计划上：programs/statics.ts 的 layerFor() 对 cost-modification 直接抛
 *    judge-required（无图层映射），cost 系统也不读图层；cost.modify 原语只产链接值，
 *    不消费卡内 static。
 * 2. 门槛「spells with [Flow] you play from your trash」需要读取“被施放牌此刻的关键词”与
 *    “本次打出使用的来源区域”两个事实：冻结的 ObjectFilter 没有关键词谓词，持续效果的
 *    持续效果也不接收被施放牌的 keyword/source-zone。程序用具名谓词记录该门槛（fail-closed），
 *    不把减费
 *    放宽成“所有你打出的法术”，也不改写费用。
 */
const abilities: Ability[] = [
  {
    kind: "static",
    effect: {
      kind: "continuous.cost-modification",
      appliesTo: "spell-play-cost",
      resource: "energy",
      amount: { kind: "constant", value: -2 },
      // 356.4.e："to a minimum of [1]" 是这条折扣自己的下限。
      minimum: { kind: "constant", value: 1 },
      // 「你打出的法术」：控制者为该能力的控制者。
      filter: { type: "spell", controller: "self" },
      when: {
        kind: "constant",
        value: { spellHasKeyword: "flow", playedFromZone: "trash" }
      }
    },
    // 门槛的真实求值路径缺失（见 judgeReason 第 2 点）：具名谓词占位，宁可 fail-closed
    // 也不把减费错误地作用到任意法术上。
    condition: {
      kind: "expression",
      value: { kind: "constant", value: "spell-with-flow-played-from-your-trash" }
    }
  }
];

export default {
  canonicalCardId: "card.hash-9570cba4ea235e9fb599afdadebd17378a1218392dfb718e244466037546deec",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两条缺口（复核 2026-10-17，均不近似实现）：(1) 没有把 CardProgram 的 static " +
    "continuous.cost-modification 安装到被施放法术费用计划的路径——programs/statics.ts 的 layerFor() 对 " +
    "cost-modification 直接抛 judge-required（无图层映射），cost 系统也不读图层；cost.modify 原语已合入" +
    "（reduce/increase、minimum、356.4 语义，产出冻结费用计划链接），但它只产链接值、不消费卡内 static；" +
    "(2) 门槛「spells with [Flow] you play from your trash」需要读取被施放牌此刻的关键词与本次打出的来源区域：" +
    "冻结 ObjectFilter 没有关键词谓词，持续效果也不接收被施放牌的 keyword/source-zone，因此程序用具名谓词占位，" +
    "不放宽成「你打出的所有法术」。印刷数值（减 2 Energy、自带最低 1）按 356.4.b/356.4.e 记录在该静态效果上，" +
    "费用计划 golden 已真实执行。依赖：static → 费用计划安装路径、flow-from-trash 门槛谓词（829.1.c）。",
  abilities,
  sourceText:
    "Spells with [Flow] you play from your trash cost :rb_energy_2: less, to a minimum of :rb_energy_1:."
} satisfies CardProgram;

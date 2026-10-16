import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Applied Researchers (ven-055-166) — Unit, Mind, Shurima.
 *
 * 原文：
 *   [Empower] :rb_energy_3: (:rb_energy_3:: Empower me. Use only if not Empowered.)
 *   [Empowered][>] Your spells cost :rb_energy_1::rb_rune_rainbow: less, to a
 *   minimum of :rb_energy_1:.
 *
 * 规则依据（Core Rules v1.5）：
 * - 827.1 / 827.1.c / 827.1.c.1：Empower 是 Activated Ability 关键词，本卡费用
 *   3 Energy，功能上等价于 "3: Empower this. Play only if not Empowered."。
 * - 828.1 / 828.1.c："[Empowered][>]" 后的整句是 Dependent Ability，只在拥有
 *   Empowered 状态时 Active。
 * - 356.4：折扣（"cost [amount] less" / "reduced by [amount]"）按 356.4.a-d 的
 *   顺序结算；356.4.e 明确"带最低值的折扣，其最低值只约束该折扣本身"。所以
 *   "to a minimum of :rb_energy_1:" 是这条折扣自己的下限（minimum），不是费用
 *   总下限，也不与其他折扣共享。
 * - 135.2.e.5 / 135.2.e.5.a：:rb_rune_rainbow:（彩虹符号）表示任意域的 Power；
 *   本条折扣同时减 1 点 Energy 与 1 点任意域 Power。
 * - 206/206.1：判定费用时使用印刷费用；折扣只作用于实际支付。
 *
 * 结构说明：两条 static 持续效果分别承载 Energy 与 Power 分量（resource 字段），
 * 都用 appliesTo 指向"你打出的法术"（filter: type spell、controller self），并挂在
 * Empowered 谓词条件下；是否 Active 与如何套用由 828.1.c 的门控与 cost/layers 消费方
 * 决定。本程序不自行改写费用，也不手写 Empowered 判定。
 */
const abilities: Ability[] = [
  {
    kind: "keyword",
    keyword: "empower",
    value: 3
  },
  {
    kind: "static",
    effect: {
      kind: "continuous.cost-modification",
      resource: "energy",
      amount: -1,
      minimum: 1,
      appliesTo: "spell-play-cost",
      filter: { type: "spell", controller: "self" }
    },
    condition: {
      kind: "expression",
      value: { kind: "constant", value: "empowered" }
    }
  },
  {
    kind: "static",
    effect: {
      kind: "continuous.cost-modification",
      resource: "power",
      amount: -1,
      domain: "any",
      appliesTo: "spell-play-cost",
      filter: { type: "spell", controller: "self" }
    },
    condition: {
      kind: "expression",
      value: { kind: "constant", value: "empowered" }
    }
  }
];

export default {
  canonicalCardId: "card.hash-ffb7fa0eb6027d1158053512ab5917c1ff4226d11f9110deeade65133c7312b4",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺两块已合入能力：(1)「[Empower] 3」与「[Empowered]」没有 KeywordDef（RIFT-83/84 关键词展开，" +
    "827.1.c.1 的起动费用和 828.1.c 的状态门控无实现）；(2)「Your spells cost [1][A] less, to a minimum " +
    "of [1]」是 cost 与 layers 的持续费用改写，卡牌没法声明可消费的 CostSpec 折扣：cost-plan.ts 的 " +
    "CostDiscount 只由 CostPlanInput 提供，没有从 CardProgram 的 static 持续效果读取 " +
    "continuous.cost-modification（含 356.4.e 的最低值）的生产接线，历史同名文件 cost.modify 也未合入" +
    "（依赖 RIFT-89 费用计划、RIFT-91 layers-continuous）。不把折扣近似成固定的整数减免，也不在卡里" +
    "手算法术费用。",
  abilities,
  sourceText:
    "[Empower] :rb_energy_3: (:rb_energy_3:: Empower me. Use only if not Empowered.)\n" +
    "[Empowered][>] Your spells cost :rb_energy_1::rb_rune_rainbow: less, to a minimum of :rb_energy_1:."
} satisfies CardProgram;

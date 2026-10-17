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
 *
 * 复核（2026-10-17，第一轮 M2 覆盖率复核）：
 * - 原 judgeReason 里的「cost.modify 未合入（依赖 RIFT-89/RIFT-261）」已过时：cost/pay、
 *   cost/modify 的指令原语仍未在本分支（instructions 注册表没有 cost.*），但真正的缺口不是
 *   某个原语名，而是**消费方**——卡牌层的费率改写没有进入费用计划的通道：
 *   cost/cost-plan.ts 的 applyDiscount 只接受调用方传进来的 CostPlanInput.discounts，
 *   readCost 明确阻断 CostSpec 里 kind/payments/energy/power/discard 之外的字段，
 *   layers/rules/query.ts 也没有 cost-modification 的查询（appliedCosts 只读 continuous.restrict
 *   的 "applied-cost"，即 204.4 的已应用费用，不是 356.4 的折扣）。因此本程序**不**改用
 *   `cost.modify`（该 op 未注册，写了也只是占位），保持 static + continuous.cost-modification
 *   数据形状，等待 CardProgram static 效果进入费用计划的接线（RIFT-257 只绑定 play/activated/
 *   触发/替代的 draft，bindStatic 默认 noopStaticBinder）。
 * - Empowered 门控（828.1.c）同样未合入：Condition 没有该谓词，layers 的 conditionMatches
 *   对未知 kind 落回 true，所以这两条 static 效果即使被绑定也会恒真。
 * 依赖：CardProgram static → 费用计划的折扣接线（含 356.4.a–e 的顺序与最低值语义）与 442.1.a
 * 的 Empowered 谓词。不把折扣近似成固定的整数减免，也不在卡里手算法术费用。
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
    "两条缺口：(1)「[Empower] 3」与「[Empowered]」没有 KeywordDef（827.1.c.1 的起动费用与 " +
    "828.1.c 的状态门控无实现；442.1.a 的 Empowered 是二元状态，ObjectSnapshot / Condition 都没有该谓词，" +
    "layers/engine.ts 的 conditionMatches 对未知 kind 落回 true，所以程序里 expression/\"empowered\" 只是" +
    "描述性记录）；(2)「Your spells cost [1][A] less, to a minimum of [1]」需要把卡牌 static 效果" +
    "（continuous.cost-modification 的 Energy 与 Power 分量）接进费用计划的折扣通道——" +
    "cost/cost-plan.ts 的 applyDiscount 只消费调用方提供的 CostPlanInput.discounts，readCost 阻断 " +
    "CostSpec 的其他字段，layers/rules/query.ts 也没有 cost-modification 查询（appliedCosts 只读 " +
    "continuous.restrict 的 204.4 applied-cost）。依赖 RIFT-257（CardProgram static 绑定，bindStatic " +
    "目前是 noopStaticBinder）与费用计划侧的连续折扣消费方（含 356.4.a 的顺序与 356.4.e 的最低值）。" +
    "不把折扣近似成固定的整数减免，也不在卡里手算法术费用。",
  abilities,
  sourceText:
    "[Empower] :rb_energy_3: (:rb_energy_3:: Empower me. Use only if not Empowered.)\n" +
    "[Empowered][>] Your spells cost :rb_energy_1::rb_rune_rainbow: less, to a minimum of :rb_energy_1:."
} satisfies CardProgram;

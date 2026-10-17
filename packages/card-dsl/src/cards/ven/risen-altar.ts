import type { CardProgram } from "../../ir/index.js";

/**
 * Risen Altar (ven-163-166) — Battlefield, Colorless.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-163-166，逐字）：
 *   "[Empower] costs of your units here cost :rb_energy_1: or :rb_rune_rainbow: less."
 *
 * 规则依据（Core Rules v1.5）：
 * - 827.1 / 827.1.c / 827.1.c.1：Empower 是启动能力关键词，功能上等价于
 *   "[Cost]: Empower this. Play only if not Empowered."，即它有一个可支付的 Empower 费用。
 * - 827.1.c.3：改变 Empower 费用的文本在“为任何原因确定该牌 Empower 费用”时计入，
 *   所以本条是作用在 Empower 费用上的减费，而不是一条独立效果。
 * - 356.4 / 356.4.b："cost … less" 是折扣，在确定总费用的折扣步骤应用；356.4.a 允许折扣由
 *   别的牌提供；356.6 规定 Energy 与 Power 费用不能降到 0 以下。
 * - 135.2.e.5 / 135.2.e.5.a、163.2.b：:rb_rune_rainbow: 是任意域 Power [A]，作为费用可由
 *   任意域 Power 支付；"or" 表示减 :rb_energy_1: 与减一个 [A] 之间二选一。
 * - 053.3："here" 指本战场；190.6.a / 190.6.d：战场能力的控制者是它的控制者，"your units"
 *   即该控制者在本战场的单位。
 *
 * 当前状态与剩余接线见 judgeReason；不以原语存在代替整卡执行证据。
 */
export default {
  canonicalCardId: "card.hash-fbf366107dc56ccff37dc34defc026e822358e66fe7bb2e1c905d067292ea927",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "仍缺静态 Empower 减费的消费路径：827.1.c.3/356.4.b 要把 your units here 的 continuous.cost-modification 收集到后续启动费用；cost.modify 与 CostPlan 折扣已存在，但 programs/statics.ts 的 layerFor 没有费用改写映射，也没有 Empower 专属 Finalize 收集器。CostDiscount.resource 仍是单资源字段，无印刷的「1 Energy 或 1 [A]」二选一决定形状；Empower KeywordDef 已注册但 KeywordAbility / programs/keywords.ts 不传递 params.cost。sameLocationAs 已由 staticFilter 归一到 source.location，剩余 here 问题在 layers/filter.ts：结构 LocationRef 仍按对象引用相等匹配，缺值比较及来源移动时更新锚点；不能宣称会正确覆盖本战场单位。保留 judge-required，不近似实现。",
  abilities: [
    {
      kind: "static",
      effect: {
        // 356.4.b（"costs [amount] less"）+ 827.1.c.3（作用在为任何原因确定 Empower 费用时）。
        kind: "continuous.cost-modification",
        appliesTo: "empower-cost",
        // 「:rb_energy_1: 或 :rb_rune_rainbow: 少 1」：两个分支按 CostDiscount 的形状记录
        // （resource / amount / domains），二选一本身没有可执行形状（见 judgeReason）。
        // [A] 分支用六域集合表示「任意域 Power 均可支付」（135.2.e.5.a / 163.2.b）。
        options: {
          kind: "constant",
          value: [
            { resource: "energy", amount: -1 },
            {
              resource: "power",
              amount: -1,
              domains: ["Fury", "Calm", "Mind", "Body", "Chaos", "Order"]
            }
          ]
        },
        // "your units here"："self" 在本战场程序的过滤器里指能力控制者（190.6.d），
        // sameLocationAs 是 053.3 的 "here" 锚点（绑定器已归一，结构地点值比较仍待接线）。
        filter: { type: "unit", controller: "self", sameLocationAs: "self" }
      }
    }
  ],
  sourceText: "[Empower] costs of your units here cost :rb_energy_1: or :rb_rune_rainbow: less."
} satisfies CardProgram;

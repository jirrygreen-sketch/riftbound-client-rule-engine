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
 * status = judge-required（复核 2026-10-16；缺口均不近似实现）：
 * 1. 没有已合入路径把 CardProgram 的 static 费用改写送进 Finalize 费用计划：
 *    cost/cost-plan.ts 的折扣仍只读调用方传入的 CostDiscount，effects/instructions/ 也还没有
 *    cost.modify（属仍在进行的 RIFT-261）；RIFT-257 的 programs/statics.ts 只有回调位，
 *    没有把 static 声明接进费用计划的实现。
 * 2. 印刷折扣是「减 :rb_energy_1: **或** 减 :rb_rune_rainbow:」的二选一，而冻结的
 *    CostDiscount 是单一 resource 记录，没有二选一形状；写死其中一个分支就是近似。
 *    （[A] 分支本身用六域 eligible 集合描述：135.2.e.5.a 允许任意域 Power 支付，
 *    封闭六域 Domain 集合没有 Universal Power 值，effect.resources 已记录同一缺口。）
 * 3. 折扣对象是「其他牌的 Empower 费用」，而 keywords/registry.generated.ts 仍没有任何
 *    Empower/Empowered KeywordDef（RIFT-81~88 关键词批次不含它们），Empower 费用无从绑定；
 *    053.3 "here" 的 sameLocationAs 锚点在解释器查询路径已实现，但 layers/filter.ts 的
 *    图层匹配器不读锚点，作用于所有战场的单位会是过度应用。
 * 依赖：新增 Empower/Empowered 关键词任务、RIFT-261（cost.modify / 费用计划接线）、
 * layers/filter.ts 的 sameLocationAs/here 锚点。
 */
export default {
  canonicalCardId: "card.hash-fbf366107dc56ccff37dc34defc026e822358e66fe7bb2e1c905d067292ea927",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口，均不近似实现：(1) 没有已合入路径把 CardProgram 的 static 费用改写安装到后续那次打出/启动的费用计划上：" +
    "cost/cost-plan.ts 的折扣只读调用方传入的 CostDiscount，effects/instructions/ 没有 cost.modify 原语（属仍在进行的 RIFT-261），" +
    "RIFT-257 的 programs/statics.ts 只有回调位、没有把 static 声明接进费用计划；" +
    "(2) 印刷折扣是「:rb_energy_1: 或 :rb_rune_rainbow: 少 1」的二选一（356.4.b、135.2.e.5.a），" +
    "而冻结的 CostDiscount 只有单一 resource 字段，没有二选一形状，写死任一分支都是近似；" +
    "(3) 折扣对象是「your units here 的 [Empower] 费用」（827.1.c.3），但 keywords/registry.generated.ts 没有任何 " +
    "Empower/Empowered KeywordDef（RIFT-81~88 批次不含），Empower 费用无从绑定；" +
    "且 \"here\" 需要的 sameLocationAs 锚点在解释器查询路径已实现，但 layers/filter.ts 的图层匹配器不读锚点，会作用到所有战场的单位。" +
    "依赖：新增 Empower/Empowered 关键词任务、RIFT-261（cost.modify 与费用计划接线）、layers/filter.ts 的 sameLocationAs/here。",
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
        // sameLocationAs 是 053.3 的 "here" 锚点（layers/filter.ts 的图层匹配器尚未读取）。
        filter: { type: "unit", controller: "self", sameLocationAs: "self" }
      }
    }
  ],
  sourceText: "[Empower] costs of your units here cost :rb_energy_1: or :rb_rune_rainbow: less."
} satisfies CardProgram;

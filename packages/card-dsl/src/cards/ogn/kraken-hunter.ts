import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Kraken Hunter (ogn-150-298) — Unit（能量 3，力量 2，Might 5，Body；Pirate/Bilgewater）。
 *
 * 原文：
 *   [Accelerate] (You may pay :rb_energy_1::rb_rune_body: as an additional cost to
 *   have me enter ready.)
 *   [Assault] (+1 :rb_might: while I'm an attacker.)
 *   As you play me, you may spend any number of buffs as an additional cost.
 *   Reduce my cost by :rb_rune_body: for each buff you spend.
 *
 * 规则依据（CR v1.5）：
 * - [Accelerate] 805 / [Assault] 807：均按契约 3.7 由已合入的 KeywordDef 展开
 *   （effects/keywords/Accelerate.ts、Assault.ts），卡程序只声明关键词与数值
 *   （Assault 无数值 → 807.1.b.3 视为 1，仍按 README 第 5 节只声明不重写）。
 * - "As you play me, you may spend any number of buffs as an additional cost."：
 *   打出时的可选附加费用，费用形态是 spend-buff（702.2.b：从单位上移除一个
 *   Buff；702.2.b.2 只能花自己控制单位的 Buff）。cost/README.md 已支持
 *   `kind: 'spend-buff'` 的 CostSpec 支付（object/objects/choice + amount），
 *   附加费舞台为 optional-additional（203.x / 356.4）。
 * - "Reduce my cost by :rb_rune_body: for each buff you spend."：按被支付的 Buff
 *   数量减少一个 Body Power；356.4.c 的组件折扣（component discount）需引用
 *   支付数量（cost 计划里的 discount amount 读不到已选的 spend-buff 数量）。
 *
 * status 判定（cards/README.md 第 2 节，2026-10-17 复核）：judge-required。
 * 关键词声明与两条 KeywordDef（Accelerate 805、Assault 807）本身有依据，但整卡不可执行：
 * - 可选附加费用的"任意数量 Buff" 需要 Finalize 阶段由玩家选择数量并逐次支付：cost-plan 的
 *   optionalAdditional 是每个组件一次的布尔选择（selected?: boolean，cost/plan-types.ts），
 *   没有"任意数量"的已被验证表达；cost/payment.ts 与 payCostPlan 也只消费已锁定的计划。
 * - 减费随支付数量联动：CostDiscount.amount 是静态 Expr（cost/plan-types.ts），
 *   读不到"本次已支付的 Buff 数"；实测把 amount 写成 linked-value 会被 buildCostPlan 以
 *   "Discount must be a nonnegative safe integer" 拒绝，成本没有把 spend-buff 的
 *   支付结果回接到 356.4.c 组件折扣的路径。
 * - Accelerate 的 `accelerate.cost` 展开没有静态层映射：programs/statics.ts 的 layerFor
 *   对 `accelerate.cost` 抛 "Static ability kind accelerate.cost has no layer mapping"（实测），
 *   关键词展开无法经 CardProgram 绑定，Finalize 也没有读取该声明的消费者。
 * - [Assault] 的 continuous.might 展开能绑定，但其条件读 `designation` 特征，
 *   ObjectSnapshot 只有 combatRole，展开的效果当前恒不生效（实测 might 不变）。
 * 依赖：可变数量附加费用、支付结果折扣接线、accelerate.cost 的 Finalize 消费与
 * designation 条件求值。不近似实现（不写成固定 0/1 个 Buff，也不写死减费量）。
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "accelerate" },
  { kind: "keyword", keyword: "assault" }
];

const program = {
  canonicalCardId: "card.hash-763d40ad13566634b64cc2de5da621393c0cf40858bb36abd9052e741aba4c2f",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "四处已实测的当前缺口：（1）“you may spend any number of buffs as an additional cost” 需要 Finalize 里" +
    "不受限数量的 spend-buff 支付选择；cost-plan 的 optionalAdditional 是每个组件一次的布尔选择" +
    "（cost/plan-types.ts selected?: boolean，207 / 356.4），没有“任意数量”的已验证表达，" +
    "payCostPlan（cost.pay 的支付入口）也只消费已锁定的计划。（2）“Reduce my cost by [Body] for each buff you spend” 是引用本次" +
    "已支付数量的组件折扣（356.4.c），CostDiscount.amount 只接受静态 Expr；实测把 amount 写成 " +
    "linked-value 会被 buildCostPlan 以 “Discount must be a nonnegative safe integer” 拒绝，支付结果" +
    "没有接回打出费用计划。（3）Accelerate 展开的 accelerate.cost 没有静态层映射：programs/statics.ts " +
    "的 layerFor 对 `accelerate.cost` 抛 “Static ability kind accelerate.cost has no layer mapping”" +
    "（实测），Finalize 也没有读取该声明的消费者。（4）[Assault] 的 continuous.might 展开能绑定，但其" +
    "designation 条件在 ObjectSnapshot 上没有特征（只有 combatRole），展开的效果当前恒不生效（实测 might 不变）。" +
    "Accelerate/Assault 只按 805/807 声明关键词，不重写展开。依赖：可变 spend-buff 费用、支付结果折扣接线、" +
    "accelerate.cost 的 Finalize 消费与 designation 条件求值。不近似实现。",
  abilities,
  sourceText:
    "[Accelerate] (You may pay :rb_energy_1::rb_rune_body: as an additional cost to have me enter ready.)\n" +
    "[Assault] (+1 :rb_might: while I'm an attacker.)\n" +
    "As you play me, you may spend any number of buffs as an additional cost. Reduce my cost by :rb_rune_body: for each buff you spend."
} satisfies CardProgram;

export default program;

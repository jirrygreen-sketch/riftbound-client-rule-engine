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
 * 关键词声明（Accelerate 805、Assault 807）本身有依据，但整卡不可执行，四处已实测缺口：
 * - 可选附加费用的"任意数量 Buff" 需要 Finalize 阶段由玩家选择数量并逐次支付：cost/plan-types.ts 的
 *   optionalAdditional 是每个组件一次的布尔选择（OptionalCostInput.selected?: boolean），
 *   计划里唯一的数量通道是锁定后的 CostAction.action.amount；没有"任意数量"的已验证表达，
 *   payCostPlan 也只消费已锁定的计划。
 * - 减费随支付数量联动：CostDiscount.amount 是静态 Expr，读不到"本次已支付的 Buff 数"；
 *   实测把 amount 写成 linked-value 会被 buildCostPlan 以 "Discount must be a nonnegative safe integer" 拒绝，
 *   固定数量的 cost.modify 已能执行；仍没有把可变 spend-buff 的费用选择数量
 *   接到减费量的路径，不能把普通静态计数或固定数量计划当作该费用已执行。
 * - Accelerate 的 `accelerate.cost` 展开没有静态层映射：programs/statics.ts 的 layerFor
 *   对 `accelerate.cost` 抛 "Static ability kind accelerate.cost has no layer mapping"（实测），
 *   关键词展开无法经 CardProgram 绑定，Finalize 也没有读取该声明的消费者（805.2.b）。
 * - [Assault] 的 continuous.might 展开能绑定，但其条件读 `designation`：默认求值（expr.ts）只查
 *   ObjectSnapshot 自身字段，对 designation 抛 MissingInformation、statics 包装吞成 false，
 *   实测 combatRole="attacker" 时 might 不变。RIFT-711 的 expr-ext/evaluate.ts 已支持该映射，
 *   但没有接进 expr.ts / layers/engine.ts / programs/statics.ts。
 * 不近似实现（不写成固定 0/1 个 Buff，也不写死减费量）。
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
    "不受限数量的 spend-buff 支付选择；cost/plan-types.ts 的 CostPlanInput.optionalAdditional 是每个组件一次的" +
    "布尔选择（OptionalCostInput.selected?: boolean，207 / 356.4），成本侧唯一的数量通道是 " +
    "CostAction.action.amount 这个锁定值，没有“任意数量”的已验证表达；payCostPlan（cost.pay 的支付入口）也只消费已锁定的计划。" +
    "（2）“Reduce my cost by [Body] for each buff you spend” 缺本次费用数量到减费量的链接（356.4.c/f）：" +
    "CostDiscount.amount 只接受静态 Expr，实测把 amount 写成 linked-value 会被 buildCostPlan 以 " +
    "“Discount must be a nonnegative safe integer” 拒绝；固定数量的 cost.modify 已能执行。" +
    "已合入的 cost/discounts 支持静态计数，但不读取本次费用所选/支付的 buff 数，生产 Finalize 也未调用该收集器。" +
    "（3）Accelerate 展开的 accelerate.cost 没有静态层映射：programs/statics.ts 的 layerFor 实测对 " +
    "`accelerate.cost` 抛 “Static ability kind accelerate.cost has no layer mapping”，" +
    "生产 static binder 无法注册，Finalize 也没有读取该声明的消费者（805.2.b）。" +
    "（4）[Assault] 展开的 continuous.might 能绑定，但 designation 条件没有生产派发：" +
    "effects/interpreter/condition.ts → expr.ts 对 property \"designation\" 抛 MissingInformation、包装层吞成 false，" +
    "实测 combatRole=\"attacker\" 时 might 仍为印刷值；expr-ext/evaluate.ts 已能映射 combatRole，" +
    "但 expr.ts、layers/engine.ts、programs/statics.ts 未引用它（807.1.c / 807.1.d.1）。" +
    "Accelerate/Assault 只按 805/807 声明关键词，不重写展开。不近似实现。",
  abilities,
  sourceText:
    "[Accelerate] (You may pay :rb_energy_1::rb_rune_body: as an additional cost to have me enter ready.)\n" +
    "[Assault] (+1 :rb_might: while I'm an attacker.)\n" +
    "As you play me, you may spend any number of buffs as an additional cost. Reduce my cost by :rb_rune_body: for each buff you spend."
} satisfies CardProgram;

export default program;

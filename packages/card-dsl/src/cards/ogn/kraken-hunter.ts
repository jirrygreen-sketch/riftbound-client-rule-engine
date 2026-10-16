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
 * status 判定（cards/README.md 第 2 节）：judge-required。
 * 关键词声明本身有依据，但整卡不可执行：
 * - 可选附加费用的"任意数量 Buff" 需要 Finalize 阶段由玩家选择数量并逐次支付：
 *   cost-plan 的 optionalAdditional 是布尔式选择（selected?: boolean，每个
 *   additional 组件一次），没有"不受限数量"的已被验证表达；同时也没有把该组件
 *   的费用减免（每 Buff 减 1 Body Power）接入 356.4.c 组件折扣的路径。
 * - 减费随支付数量联动：cost-plan 的 CostDiscount 只接受静态 Expr amount，
 *   无法读"本次已支付的 Buff 数"。
 * 依赖：cost.additional 的可变数量选择（RIFT-89 费用计划）与引用已支付数量的
 * 组件折扣。不近似实现（不写成固定 0/1 个 Buff，也不写死减费量）。
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
    "缺可变数量的附加费用与随支付数量联动的减费：（1）“you may spend any number of buffs " +
    "as an additional cost” 需要 Finalize 里不受限数量的 spend-buff 支付选择；已合入 cost-plan " +
    "的 optionalAdditional 是每个组件一次的布尔选择（207 / 356.4），没有“任意数量”的" +
    "已验证表达（cost/README.md：非标准费用按对象选择，amount 用于 spend-buff 的" +
    "单对象 Buff 数，不能表达跨对象的不限数量）。（2）“Reduce my cost by [Body] for each " +
    "buff you spend” 是引用本次已支付数量的组件折扣（356.4.c），CostDiscount.amount 只接受" +
    "静态 Expr，读不到已支付的 Buff 数。依赖：RIFT-89（batch3-cost-plan）的可变数量附加费" +
    "与引用支付结果的折扣。Accelerate/Assault 只按 805/807 声明关键词，不重写展开。不近似实现。",
  abilities,
  sourceText:
    "[Accelerate] (You may pay :rb_energy_1::rb_rune_body: as an additional cost to have me enter ready.)\n" +
    "[Assault] (+1 :rb_might: while I'm an attacker.)\n" +
    "As you play me, you may spend any number of buffs as an additional cost. Reduce my cost by :rb_rune_body: for each buff you spend."
} satisfies CardProgram;

export default program;

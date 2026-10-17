/**
 * Guardian Angel （sfd-051-221）— Gear，2 energy、power null，Might 1，Calm，Equipment。
 *
 * sourceText（逐字取自 packages/card-data/data/deck-catalog.json sfd-051-221）：
 *   "[Equip] :rb_rune_calm: (:rb_rune_calm:: Attach this to a unit you control.)"
 *
 * 规则依据（CR v1.5）：
 * - 818.1 / 818.1.b：Equip 是启动式能力关键词，支付费用后把带此关键词的卡附着到所选单位；
 *   818.1.b.1 该选择是 Target，818.1.b.2 被选单位成为 Top-Most Card。
 * - 818.1.c / 818.1.c.2：格式为 "Equip [费用]"，功能上等于「[费用]：把此装备附着到 you
 *   control 的一个单位」。本卡印刷的 Equip 费用是 1 点 Calm Power（135.2.e.4），沿用同目录
 *   已合入装备程序的约定：value 记印刷的 Power 数量 1，costDomain 记领域 "Calm"；印刷的
 *   2 energy 是 Gear 的打出费用（150.4），不是 Equip 费用。
 * - 150.1–150.3：Equipment 是带 Equipment 标签的 Gear，可以有 Equip；本地 catalog 的
 *   tags 为 ["Equipment"]，与 818.1.a 一致。
 *
 * status = judge-required（缺可支付的费用路径，不近似实现）：
 * - 已合入的 Equip 展开声明 payments: [{ kind: "equip", value: { kind: "source" } }]，
 *   费用管线 cost/plan-values.ts 仍把未知支付种类视为 blocked：golden 实测 buildCostPlan
 *   抛 CostPlanError（reason "judge-required"，message "Unsupported payment kind: equip"）。
 * - 印刷的装备费（1 点 Calm Power）只以描述性 costDomain 记录：KeywordDef.expand 的
 *   params.cost 承载通道虽在契约 3.8 第 3 条冻结、接口也有 params 字段，但没有装配方把
 *   KeywordAbility 的印刷参数传进展开，卡牌程序 → 关键词展开 → 时点/链的接线仍未接通。
 * - 依赖：RIFT-261（Equip 费用支付种类）与关键词装配接线。不近似实现。
 */
export default {
  canonicalCardId: "card.hash-af3547abb5e6d69c2372b62331d6039acaf16cca337eefb27e5734bbee3fb307",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "印刷的 [Equip] 费用（1 点 Calm Power，818.1.c.2）目前无法支付：已合入的 Equip 展开" +
    "（RIFT-87，effects/keywords/Equip.ts）声明 payments: [{ kind: \"equip\", value: { kind: \"source\" } }]，" +
    "费用管线 cost/plan-values.ts 的 readCost 对未知支付种类直接 blocked —— golden 实测 buildCostPlan " +
    "抛 CostPlanError（reason \"judge-required\"，message \"Unsupported payment kind: equip\"）；" +
    "该支付种类的补齐属 RIFT-261（未合入 HEAD）。印刷装备费同样没有装配通道：KeywordDef.expand 的" +
    "params.cost 虽在契约 3.8 第 3 条冻结、接口也有 params 字段，但没有装配方把 KeywordAbility 的" +
    "印刷参数传进展开，卡牌程序 → 关键词展开 → 时点/链的接线未接通。不近似实现（不把 Equip 降级成裸 effect.attach）。",
  abilities: [
    { kind: "keyword", keyword: "equip", value: 1, costDomain: "Calm" }
  ],
  sourceText:
    "[Equip] :rb_rune_calm: (:rb_rune_calm:: Attach this to a unit you control.)"
} as const;

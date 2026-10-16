import type { CardProgram } from "../../ir/index.js";

/**
 * Hand Hammer (ven-027-166) — Gear, 2 Energy, power null (no printed Power),
 * Might 1, Calm, tag Equipment.
 *
 * sourceText（逐字取自 packages/card-data/data/deck-catalog.json, ven-027-166）：
 *   "[Equip] :rb_rune_calm: (:rb_rune_calm:: Attach this to a unit you control.)"
 *
 * 规则依据（CR v1.5）：
 * - 818.1 / 818.1.a：Equip 是启动式能力关键词，出现在带 Equipment 标签的 Gear 上
 *   （149.1 / 150.1–150.4：Equipment 仍是 Gear，印刷 2 energy 是 Gear 的打出费用）。
 * - 818.1.c / 818.1.c.2：格式为 "Equip [Cost]"，功能上等于「[费用]：把此装备附着到
 *   you control 的一个单位」；818.1.b.1 明确该选择是 Target，818.1.b.2 说明被选单位
 *   成为附着动作的 Top-Most Card。
 * - 135.2.e.4 / 163.2.b：印刷的 :rb_rune_calm: 是 1 点 Calm Power（本卡无能量费用）。
 *
 * status = judge-required（缺可支付的费用路径与关键词接线，不近似实现）：
 * 1. 没有已合入路径把 CardProgram 的 keyword 能力接进 effects/keywords/Equip.ts 并
 *    在链上形成启动能力（契约 3.5 的卡牌程序 → 关键词展开 → 时点/链接线）；契约 3.8.3
 *    要求的 KeywordDef.expand 印刷费用入口（params.cost）尚未实现，已合入的 expand
 *    只接受 value / host，印刷的 1 Calm Power 无法传进去。
 * 2. 已合入的 Equip 展开声明 cost.payments: [{ kind: "equip", value: source }]，
 *    cost/plan-values.ts 的 readCost 对未知支付种类直接 blocked —— golden 实测
 *    buildCostPlan 抛 CostPlanError（reason "judge-required"，message
 *    "Unsupported payment kind: equip"）。
 * 依赖：RIFT-89 之后的 Equip 费用支付支持与 RIFT-120 的关键词/触发接线。
 * 已合入的 effect.attach 半段由 golden 用真实原语执行；费用不可支付，故整卡不标 executable。
 */
/**
 * 818.1.c：印刷的 Equip 费用是 1 点 Calm Power；value 记印刷资源符号数，costDomain 记该
 * Power 的领域（同目录 sfd/dorans-shield 的既存写法）。印刷的 2 energy 是 Gear 的打出费用
 * （149.1/359.2.d），不是 Equip 费用。costDomain 是契约外的扩展字段，因此用 as const
 * 声明后再放进 abilities。
 */
const equip = {
  kind: "keyword",
  keyword: "equip",
  value: 1,
  costDomain: "Calm"
} as const;

export default {
  canonicalCardId: "card.hash-e38beb4c962c62133ef5050acc2896b4578a668939323e65af883d81c8ada753",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "[Equip] 的印刷费用（1 点 Calm Power，818.1.c / 135.2.e.4）目前不可支付，且关键词无法接线：" +
    "(1) 没有已合入路径把 CardProgram 的 keyword 能力经 effects/keywords/Equip.ts 展开后注册为链上的启动能力" +
    "（契约 3.5 的卡牌程序→关键词→时点/链接线未合入），契约 3.8.3 要求的 KeywordDef.expand 输入 " +
    "params.cost 也还没有落进已合入的 KeywordDef 签名，印刷费用无法传给展开；" +
    "(2) 已合入的 Equip 展开声明 cost.payments: [{ kind: \"equip\", value: source }]，" +
    "cost/plan-values.ts 的 readCost 对未知支付种类直接 blocked：golden 实测 buildCostPlan 抛 " +
    "CostPlanError（reason \"judge-required\"，message \"Unsupported payment kind: equip\"）。" +
    "依赖 RIFT-89 之后的 Equip 费用支付支持与 RIFT-120 的关键词接线；不近似实现" +
    "（不把 Equip 降级成裸 effect.attach）。已合入的 effect.attach 半段由 golden 真实执行。",
  abilities: [equip],
  sourceText:
    "[Equip] :rb_rune_calm: (:rb_rune_calm:: Attach this to a unit you control.)"
} satisfies CardProgram;

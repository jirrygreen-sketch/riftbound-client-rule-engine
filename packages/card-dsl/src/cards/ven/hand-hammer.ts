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
 * 复核（2026-10-17，第二轮 M2 覆盖率复核）：
 * - 旧 judgeReason 的「describeActivate 接线全缺（契约 3.5）」与「RIFT-89/RIFT-120」
 *   已不成立：ProgramBinding.createProgramBinding + ChainEngine.describeActivate
 *   已把本卡的 Equip 展开注册成链上启动能力（实测返回 action 速度的 cost draft，
 *   payments equip 原样传递）；expandProgram 已接受 value/host，只是不透传
 *   KeywordDef 接口里已声明的 params.cost（effects/keyword-contract.ts 有形、
 *   programs/keywords.ts 展开器不传）。
 * - 真实缺口只剩付费路径：
 * 1. 契约 3.8.3 在 KeywordDef 接口里声明的 params.cost 还不能从卡程序透传给展开器
 *    （expandProgram 只传 value/host），印刷的 1 Calm Power 无法传进去。
 * 2. 已合入的 Equip 展开声明 cost.payments: [{ kind: "equip", value: source }]，
 *    cost/plan-values.ts 的 readCost 对未知支付种类直接 blocked —— golden 实测
 *    buildCostPlan 抛 CostPlanError（reason "judge-required"，message
 *    "Unsupported payment kind: equip"）。
 *    cost/plan-values.ts 的 readCost 对未知支付种类直接 blocked —— golden 实测
 *    buildCostPlan 抛 CostPlanError（reason "judge-required"，message
 *    "Unsupported payment kind: equip"）；生产链 finalize 同样抛
 *    ChainContractBlockedError（实测 describeActivate 成功后 chain.execute 失败）。
 * 依赖：expandProgram 的 params.cost 透传、Equip 费用支付支持。
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
    "[Equip] 的印刷费用（1 点 Calm Power，818.1.c / 135.2.e.4）目前不可支付，且印刷费用无法传给展开；" +
    "两处缺口均不近似实现：(1) 契约 3.8.3 在 KeywordDef 接口里声明的 params.cost 还不能从卡程序透传——" +
    "programs/keywords.ts 的 expandProgram 只传 value/host（effects/keyword-contract.ts 的接口有 params.cost 形、" +
    "展开器不读），印刷的 1 Calm Power 进不了 KeywordDef.expand；(2) 已合入的 Equip 展开声明 " +
    "cost.payments: [{ kind: \"equip\", value: source }]，cost/plan-values.ts 的 readCost 对未知支付种类直接 blocked：" +
    "golden 实测 buildCostPlan 抛 CostPlanError（reason \"judge-required\"，message \"Unsupported payment kind: equip\"），" +
    "生产链 finalize 同样抛 ChainContractBlockedError（ProgramBinding + ChainEngine.describeActivate 已把本卡展开注册成" +
    "链上启动能力并返回 cost draft，实测 chain.execute 在付费时失败）。不近似实现（不把 Equip 降级成裸 effect.attach）。" +
    "已合入的 effect.attach 半段由 golden 真实执行。依赖：expandProgram 的 params.cost 透传、Equip 费用支付支持。",
  abilities: [equip],
  sourceText:
    "[Equip] :rb_rune_calm: (:rb_rune_calm:: Attach this to a unit you control.)"
} satisfies CardProgram;

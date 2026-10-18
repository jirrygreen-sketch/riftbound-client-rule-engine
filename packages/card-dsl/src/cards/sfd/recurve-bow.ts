/**
 * Recurve Bow （sfd-016-221）— Gear，2 energy、power null（无印刷 Power），Might 0，
 * Fury，Equipment。
 *
 * sourceText（逐字取自 packages/card-data/data/deck-catalog.json sfd-016-221）：
 *   "[Equip] :rb_rune_fury: (:rb_rune_fury:: Attach this to a unit you control.)"
 *
 * 规则依据（CR v1.5）：
 * - 818.1 / 818.1.b：Equip 是启动式能力关键词，支付费用后把带此关键词的卡附着到所选单位；
 *   818.1.b.1 该选择是 Target。
 * - 818.1.c / 818.1.c.2：格式为 "Equip [费用]"，功能上等于「[费用]：把此装备附着到 you
 *   control 的一个单位」。本卡印刷的 Equip 费用是 1 点 Fury Power（135.2.e.4），沿用同目录
 *   已合入装备程序的约定：value 记印刷的 Power 数量 1，costDomain 记领域 "Fury"；印刷的
 *   2 energy 是 Gear 的打出费用（150.4），不是 Equip 费用。
 * - 150.1–150.3：Equipment 是带 Equipment 标签的 Gear，可以有 Equip；本地 catalog 的
 *   tags 为 ["Equipment"]，与 818.1.a 一致。
 *
 * status = judge-required（复核 2026-10-17；缺可支付的费用路径与印刷费用绑定，不近似实现）：
 * - 已合入的 Equip 展开声明 payments: [{ kind: "equip", value: source }]，费用管线
 *   cost/plan-values.ts 对未知支付种类仍直接 blocked：实测 buildCostPlan 抛
 *   CostPlanError（reason "judge-required"，message "Unsupported payment kind: equip"）。
 * - 契约 3.8 第 3 条要求 expand 用 params.cost 承载印刷装备费：KeywordDef.expand 的签名已带
 *   params?.cost，但 effects/keywords/Equip.ts 的 expand 仍未读取它，印刷的 1 点 Fury Power
 *   没有绑定进展开结果，因此本卡的 costDomain 仍只是描述性记录。
 * - 关键词展开已由 programs/keywords.ts 接入卡牌程序（RIFT-257），RIFT-261 的费用种类与
 *   cost.pay / cost.modify 也已合入，但两者都未覆盖 equip 支付种类（RIFT-261 的后续改动
 *   仍在 cost/plan-values.ts 的 readCost 中把 equip 判为 judge-required），故整卡保持
 *   judge-required。不近似实现（不把 Equip 降级成裸 effect.attach）。
 * - 依赖：equip 支付种类与 Equip.ts 的 params.cost 绑定。
 */
export default {
  canonicalCardId: "card.hash-553d60be98d221dc71d4e71eb6ae5938143fa0c4b71e6e96d27d8570521d36eb",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "印刷的 [Equip] 费用（1 点 Fury Power，818.1.c.2）目前无法支付，两处当前缺口均不近似实现：" +
    "已合入的 Equip 展开" +
    "（RIFT-87，effects/keywords/Equip.ts）声明 payments: [{ kind: \"equip\", value: source }]，" +
    "费用管线 cost/plan-values.ts 的 readCost 对未知支付种类仍直接 blocked —— 实测 buildCostPlan " +
    "抛 CostPlanError（reason \"judge-required\"，message \"Unsupported payment kind: equip\"）；" +
    "RIFT-261 合入的 cost.pay / cost.modify 也不接受该支付种类（cost.modify 的 reduce-equip-cost " +
    "分支仍抛 CostPlanError）。契约 3.8 第 3 条要求 expand 用 params.cost 承载印刷装备费，" +
    "KeywordDef.expand 的签名虽已带 params?.cost，" +
    "但 Equip.ts 的 expand 仍未读取它（印刷费用未绑定进展开结果，本卡的 costDomain 仍是描述性记录）。" +
    "卡牌程序 → 关键词展开的接线已合入（RIFT-257 的 programs/keywords.ts），缺口在费用支付与费用绑定。" +
    "依赖：equip 支付种类与 Equip.ts 的 params.cost 绑定。",
  abilities: [
    { kind: "keyword", keyword: "equip", value: 1, costDomain: "Fury" }
  ],
  sourceText:
    "[Equip] :rb_rune_fury: (:rb_rune_fury:: Attach this to a unit you control.)"
} as const;

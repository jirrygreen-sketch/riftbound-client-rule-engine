/**
 * Serrated Dirk （sfd-009-221）— Gear，1 energy、power null（无印刷 Power），Might 0，
 * Fury，Equipment。
 *
 * sourceText（逐字取自 packages/card-data/data/deck-catalog.json sfd-009-221）：
 *   "[Equip] :rb_rune_fury: (:rb_rune_fury:: Attach this to a unit you control.)"
 *
 * 规则依据（CR v1.5）：
 * - 818.1 / 818.1.b：Equip 是启动式能力关键词，支付费用后把带此关键词的卡附着到所选单位；
 *   818.1.b.1 该选择是 Target，818.1.b.2 被选单位成为 Attach 动作的 Top-Most Card。
 * - 818.1.c / 818.1.c.2：格式为 "Equip [费用]"，功能上等于「[费用]：把此装备附着到 you
 *   control 的一个单位」。本卡印刷的 Equip 费用是 1 点 Fury Power（135.2.e.4 的领域符号），
 *   沿用同目录已合入装备程序（long-sword、bf-sword 等）的记录约定：value 记印刷的 Power
 *   数量 1，costDomain 记该 Power 的领域 "Fury"。印刷的 1 energy 是 Gear 的打出费用
 *   （150.4），不是 Equip 费用。
 * - 150.1–150.3：Equipment 是带 Equipment 标签的 Gear，可以有 Equip；本地 catalog 的
 *   tags 为 ["Equipment"]，与 818.1.a 一致。
 *
 * status = judge-required（缺可支付的费用路径，不近似实现）。已合入的部分：KeywordDef.expand 的
 * params（契约 3.8 第 3 条）、Equip KeywordDef（RIFT-87/264～268 关键词批次）与 CardProgram
 * 绑定（RIFT-257）——programs/activate.ts 的 describeActivate 能为本卡给出
 * { kind: "activated", timing: "action", cost.payments: [{ kind: "equip" }] } 的链草稿，
 * 展开体末步的 effect.attach 也真实附着（golden 执行）。仍然缺的部分：
 * - 费用管线 cost/plan-values.ts 的 readCost 对未知支付种类直接 blocked：golden 实测
 *   buildCostPlan 抛 CostPlanError（reason "judge-required"，message
 *   "Unsupported payment kind: equip"），即 818.1.b / 818.1.c 的启动费用目前无法支付；
 * - 印刷的 1 点 Fury Power 也还没有从 KeywordAbility 流到 expand 的 params.cost 的调用方
 *   （programs/keywords.ts 的 expandProgram 只传 value/host）。
 * 依赖：RIFT-261（cost.pay / cost.modify 与 Equip 费用计划接线）。不把 Equip 降级成裸 effect.attach
 * （那会绕开 818.1.c.4 的费用改写与 355 的 Finalize 流程）。
 */
export default {
  canonicalCardId: "card.hash-2d46595233b37a0868857eab035ad4fa4dc53fc8c932d35ad32cca2c54ff06d2",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "印刷的 [Equip] 费用（1 点 Fury Power，818.1.c.2）仍无法支付，但缺失环节已收窄到费用管线：" +
    "KeywordDef.expand 的 params（契约 3.8 第 3 条）、Equip KeywordDef（RIFT-87）与 CardProgram 绑定" +
    "（RIFT-257）都已合入——describeActivate 能返回带着 { kind: \"equip\" } 支付分量的启动草稿，" +
    "展开体末步 effect.attach 也真实执行。费用管线 cost/plan-values.ts 的 readCost 仍对未知支付种类直接 " +
    "blocked —— golden 实测 buildCostPlan 抛 CostPlanError（reason \"judge-required\"，message " +
    "\"Unsupported payment kind: equip\"）；同时印刷费用还没有从 KeywordAbility 流到 expand 的 " +
    "params.cost 的调用方（契约 3.8 第 3 条的 expand params.cost；programs/keywords.ts 只传 value/host，故 818.1.c.2 的" +
    "装备费形状目前只由 KeywordAbility 的 value/costDomain 描述）。" +
    "依赖：进行中的 RIFT-261（cost.pay / cost.modify 与 Equip 费用计划接线）。" +
    "不近似实现（不把 Equip 降级成裸 effect.attach）。",
  abilities: [
    { kind: "keyword", keyword: "equip", value: 1, costDomain: "Fury" }
  ],
  sourceText:
    "[Equip] :rb_rune_fury: (:rb_rune_fury:: Attach this to a unit you control.)"
} as const;

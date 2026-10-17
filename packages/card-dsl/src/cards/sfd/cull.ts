/**
 * Cull (sfd-134-221) — Gear, 1 energy, Might 1, Chaos, tag Equipment.
 *
 * sourceText（逐字取自 packages/card-data/data/deck-catalog.json sfd-134-221）：
 *   "[Equip] :rb_rune_chaos: (:rb_rune_chaos:: Attach this to a unit you control.)"
 *
 * 规则依据（CR v1.5）：
 * - 818.1 / 818.1.a：Equip 是启动式能力关键词，出现在带 Equipment 标签的 Gear 上
 *   （本地 catalog 的 tags 为 ["Equipment"]）。
 * - 818.1.b / 818.1.b.1 / 818.1.b.2：支付费用后把带此关键词的卡附着到所选单位；该选择是
 *   Target，附着完成后该单位成为 Top-Most Card。
 * - 818.1.c / 818.1.c.2：格式为 "Equip [费用]"，功能上等于「[费用]：把此装备附着到
 *   you control 的一个单位」。本卡印刷的 Equip 费用是 1 点 Chaos Power（135.2.e.4）。
 *   沿用同目录已合入 sfd 装备程序的约定：value 记印刷的 Power 数量 1，costDomain 记领域
 *   "Chaos"；印刷的 1 energy 是 Gear 自身的打出费用（150.4），不是 Equip 费用。
 *
 * status = judge-required（缺可支付的费用路径，不近似实现）：
 * - 已合入的 Equip 展开（effects/keywords/Equip.ts）声明
 *   payments: [{ kind: "equip", value: { kind: "source" } }]，而费用管线
 *   cost/plan-values.ts 的 readCost 没有 "equip" 这一支付种类，buildCostPlan 抛
 *   CostPlanError（reason "judge-required"，message "Unsupported payment kind: equip"），
 *   Equip 的启动费用因此无法计算/支付。
 * - 契约 3.8 第 3 条要求 expand 用 params.cost 承载印刷装备费，已合入的 KeywordDef
 *   接口虽声明了 params（keyword-contract.ts），但 programs/keywords.ts 的 expandProgram
 *   只传 { value, host }，印刷的 Chaos 符文没有传到 expand。
 * - 不把 Equip 降级成裸 effect.attach：那会绕开 818.1.c 的费用与费用改写语义。
 */
export default {
  canonicalCardId: "card.hash-bb1fcaa45b988af1dbf230e70a71fec0ff63d89d772cedb858639514745d573d",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "印刷的 [Equip] 费用（1 点 Chaos Power，818.1.c.2）目前无法支付：已合入的 Equip 展开" +
    "（effects/keywords/Equip.ts）声明 payments: [{ kind: \"equip\", value: source }]，" +
    "费用管线 cost/plan-values.ts 的 readCost 没有 \"equip\" 支付种类，buildCostPlan 抛 " +
    "CostPlanError（\"Unsupported payment kind: equip\"），启动费用无法计算/支付。" +
    "契约 3.8 第 3 条要求 expand 用 params.cost 承载印刷装备费，已合入的 KeywordDef 虽声明了 params，" +
    "但 programs/keywords.ts 的 expandProgram 只传 { value, host }，印刷的 Chaos 符文没有落到 " +
    "expand 参数上。" +
    "不近似实现（不把 Equip 降级成裸 effect.attach）。",
  abilities: [
    { kind: "keyword", keyword: "equip", value: 1, costDomain: "Chaos" }
  ],
  sourceText:
    "[Equip] :rb_rune_chaos: (:rb_rune_chaos:: Attach this to a unit you control.)"
} as const;

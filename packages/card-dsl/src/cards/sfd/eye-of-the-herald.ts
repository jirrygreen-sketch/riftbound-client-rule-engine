import type { CardProgram } from "../../ir/index.js";

/**
 * Eye of the Herald (sfd-153-221) — Gear, 1 energy, Might 0, Order, tag Equipment.
 *
 * sourceText（逐字取自 packages/card-data/data/deck-catalog.json sfd-153-221）：
 *   "[Equip] :rb_rune_order: (:rb_rune_order:: Attach this to a unit you control.)"
 *
 * 规则依据（CR v1.5）：
 * - 818.1 / 818.1.a：Equip 是启动式能力关键词，出现在带 Equipment 标签的 Gear 上
 *   （本地 catalog 的 tags 为 ["Equipment"]）。
 * - 818.1.b / 818.1.b.1 / 818.1.b.2：支付费用后把带此关键词的卡附着到所选单位；该选择是
 *   Target，附着完成后该单位成为 Top-Most Card。
 * - 818.1.c / 818.1.c.2：格式为 "Equip [费用]"，功能上等价于「[费用]：把此装备附着到
 *   you control 的一个单位」。本卡印刷的 Equip 费用是 1 点 Order Power（135.2.e.4）。
 *   value 保留印刷符号数量 1，Order 领域留在 sourceText 中；KeywordAbility 契约无
 *   印刷装备费字段。1 energy 是 Gear 的打出费用（150.4），不是 Equip 费用。
 * - 印刷 Might 0 是 Gear 的印刷特征（150.1/150.2），保持原值，不改写。
 *
 * status = judge-required（缺印刷 Equip 费用的传递与启动支付接线，不近似实现）：
 * - 已合入的 Equip 展开（effects/keywords/Equip.ts）声明
 *   payments: [{ kind: "equip", value: { kind: "source" } }]，而费用管线
 *   cost/plan-values.ts 的 readCost 没有 "equip" 这一支付种类（实测 buildCostPlan 抛
 *   "Unsupported payment kind: equip"），
 *   Equip 的启动费用因此无法计算/支付；契约 3.8 第 3 条要求 expand 用
 *   params.cost 承载印刷装备费；该参数已存在，但 Equip.expand() 未消费。
 * - programs/keywords.ts 已接通通用展开，但未传入 params.cost；印刷 Equip 费用尚未接入。
 * - 不把 Equip 降级成裸 effect.attach：那会绕开 818.1.c 的费用与费用改写语义。
 */
export default {
  canonicalCardId: "card.hash-67da502bedfc109e81093202c4a30a43cf37ca8aada9f1460b33bee5c979fdae",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "印刷 Equip 费用为 1 Order Power（818.1.c.2/818.1.c.3）。Attach 子效果已可执行，但 Equip.ts 展开仍声明 payments: [{ kind: \"equip\" }]，cost/plan-values.ts 返回 \"Unsupported payment kind: equip\"。KeywordDef 的 params.cost 已存在，但 programs/keywords.ts 未传入，Equip.expand() 未消费；卡牌 KeywordAbility 契约也没有印刷费用字段，原有 costDomain 注记不参与费用计划。缺口是可信印刷 Equip CostSpec 的传递与启动支付接线，保持 judge-required。",
  abilities: [
    { kind: "keyword", keyword: "equip", value: 1 }
  ],
  sourceText:
    "[Equip] :rb_rune_order: (:rb_rune_order:: Attach this to a unit you control.)"
} satisfies CardProgram;

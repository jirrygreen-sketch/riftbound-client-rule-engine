import type { CardProgram } from "../../ir/index.js";

/**
 * World Atlas (sfd-086-221) — Gear, 3 energy, Might 2, 领域 Mind, 标签 Equipment。
 *
 * sourceText（逐字取自 packages/card-data/data/deck-catalog.json sfd-086-221）：
 *   "[Equip] :rb_rune_mind: (:rb_rune_mind:: Attach this to a unit you control.)"
 *
 * 规则依据（CR v1.5）：
 * - 818.1/818.1.a：Equipment 标签的 Gear 带 Equip 启动式关键词；
 *   818.1.b/818.1.b.1/818.1.b.2：附着是启动能力，选择的单位是 Target；
 *   818.1.c/818.1.c.2：印刷费用 1 个 Mind 符文（无能量符号），功能上等价 "[Mind]: 附着到你控制的一个单位"。
 * - 展开归 effects/keywords/Equip.ts（818.1.c.3/.c.4 的费用改写文本本卡没有）。
 *
 * status = judge-required：Equip 启动费用仍不可支付。
 * (1) 印刷费用到不了 KeywordDef.expand：契约 3.8.3 定义了 params.cost，但 programs/keywords.ts 仍只传 value/host；
 *     契约 3.1 的 KeywordAbility 也没有承载印刷费用的字段，所以卡只能以 value: 1 记录印刷符号数。
 * (2) 已合入的 Equip 展开声明 payments: [{ kind: "equip" }]，cost/plan-values.ts 的 readCost 对未知支付种类 blocked
 *     （实测 CostPlanError reason "judge-required"，message "Unsupported payment kind: equip"）；cost.pay / cost.modify 未合入（RIFT-261）。
 * 已可真实执行：Equip 展开的 activated 形状与 effect.attach 本体（golden 用卡自身的 keyword 声明驱动的真实展开执行并断言附着）；
 * 不近似实现（不以全价启动、不用具名符文替代、不写死费用）。
 */
// Printed "Equip [Mind]": one Mind Power rune and no Energy symbol. value counts
// the printed resource symbols and costDomain records the Power rune (the same
// extension-field convention the sibling Equipment cards use); contract 3.1's
// KeywordAbility still has no field for the printed cost, so nothing consumes it
// yet (see judgeReason).
const equip = {
  kind: "keyword",
  keyword: "equip",
  value: 1,
  costDomain: "Mind"
} as const;

export default {
  canonicalCardId: "card.hash-2d067a6d3e2dbc9738ed7868ad7bea2727fdc69a8074c639e913e6360798d27c",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "Equip 的启动费用仍不可支付：(1) 印刷费用无法进入 KeywordDef.expand——契约 3.8.3 的 params.cost 已在 KeywordDef 类型上定义，" +
    "但 programs/keywords.ts 仍以 `def.expand({ value, host })` 调用、不传 params，契约 3.1 的 KeywordAbility 也不承载印刷费用，" +
    "卡侧只能以 value: 1 记录印刷符号数；" +
    "(2) 已合入的 Equip 展开（RIFT-87）声明 payments: [{ kind: \"equip\" }]，cost/plan-values.ts 的 readCost 对未知支付种类 blocked，" +
    "实测 buildCostPlan 抛 CostPlanError（reason \"judge-required\"，message \"Unsupported payment kind: equip\"）；cost.pay/cost.modify 未合入（RIFT-261）。" +
    "已可真实执行：Equip 展开的 activated 能力（818.1.b）与 effect.attach 本体（818.2），golden 用真实展开 + 参考内核断言附着结果。" +
    "印刷 Equip 费用为 1 个 Mind 符文（:rb_rune_mind:，无能量符号）。不近似实现。依赖：RIFT-261 与 params.cost 消费接线。",
  abilities: [equip],
  sourceText: "[Equip] :rb_rune_mind: (:rb_rune_mind:: Attach this to a unit you control.)"
} satisfies CardProgram;

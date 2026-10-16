import type { CardProgram } from "../../ir/index.js";

/**
 * World Atlas (sfd-086-221) — Gear, 3 energy, Might 2, 领域 Mind, 标签 Equipment。
 *
 * sourceText（逐字取自 packages/card-data/data/deck-catalog.json sfd-086-221）：
 *   "[Equip] :rb_rune_mind: (:rb_rune_mind:: Attach this to a unit you control.)"
 *
 * 规则依据（CR v1.5）：同 Experimental Hexplate —— 818.1/818.1.a 的 Equipment 标签、
 * 818.1.b/818.1.b.1/818.1.b.2 的启动式附着与 Target、818.1.c/818.1.c.2 的印刷费用
 * （1 个 Mind 符文，无能量符号）。展开归 effects/keywords/Equip.ts。
 *
 * status = judge-required：Equip 启动费用不可支付（cost/plan-values.ts 的 readCost 对
 * `kind: "equip"` 调用 blocked；实测 buildCostPlan 抛 CostPlanError，reason
 * "judge-required"，message "Unsupported payment kind: equip"），且缺少卡牌程序 →
 * 关键词展开 → 链的接线（契约 3.5）。依赖 RIFT-89 后续的 Equip 费用支付种类；不近似实现。
 */
export default {
  canonicalCardId: "card.hash-2d067a6d3e2dbc9738ed7868ad7bea2727fdc69a8074c639e913e6360798d27c",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "Equip 的启动费用无法在费用管线支付：已合入的 Equip 展开（RIFT-87）声明 payments: [{ kind: \"equip\" }]，" +
    "cost/plan-values.ts 的 readCost 对未知支付种类调用 blocked，实测 buildCostPlan 抛 CostPlanError" +
    "（reason \"judge-required\"，message \"Unsupported payment kind: equip\"）；同时缺少卡牌程序 → 关键词展开 → " +
    "时点/链的接线（契约 3.5）。印刷 Equip 费用为 1 个 Mind 符文（:rb_rune_mind:，无能量符号）；契约 3.1 的 " +
    "KeywordAbility 没有承载印刷费用组成的字段，故只以 value: 1 记录印刷符号数。依赖：Equip 费用支付种类" +
    "（RIFT-89 后续）与关键词展开接线。不近似实现。",
  abilities: [
    { kind: "keyword", keyword: "equip", value: 1 }
  ],
  sourceText: "[Equip] :rb_rune_mind: (:rb_rune_mind:: Attach this to a unit you control.)"
} satisfies CardProgram;

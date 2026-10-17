import type { CardProgram } from "../../ir/index.js";

/**
 * Experimental Hexplate (sfd-073-221) — Gear, 1 energy, Might 1, 领域 Mind, 标签 Equipment。
 *
 * sourceText（逐字取自 packages/card-data/data/deck-catalog.json sfd-073-221）：
 *   "[Equip] :rb_rune_mind: (:rb_rune_mind:: Attach this to a unit you control.)"
 *
 * 规则依据（CR v1.5）：
 * - 818.1 / 818.1.a / 818.1.b / 818.1.b.1 / 818.1.b.2：本卡带 Equipment 标签，[Equip]
 *   是启动式能力关键词，功能上等于「[费用]: Attach this to a chosen unit you control」，
 *   所选单位是 Target，并成为 Attach 的 Top-Most Card。展开由已合入的
 *   effects/keywords/Equip.ts 负责（README 第 5 节：卡牌层只声明关键词）。
 * - 818.1.c / 818.1.c.2：印刷费用只有 1 个 Mind 符文符号，没有能量符号部分。
 *
 * status = judge-required：Equip 的启动费用在已合入的费用管线里无法支付。Equip 展开声明
 * `payments: [{ kind: "equip", … }]`，而 cost/plan-values.ts 的 readCost 对未知支付种类
 * 调用 blocked——实测 buildCostPlan 抛 CostPlanError（reason "judge-required"，message
 * "Unsupported payment kind: equip"）；同时缺少卡牌程序 → 关键词展开 → 时点/链的接线
 * （契约 3.5，RIFT-257）。不把 Equip 近似成裸 effect.attach 指令（那会绕开 818.1.c.3/c.4
 * 的费用与费用改写语义）。与 M2 rad/gear 2/3 的 Nazuman Ntofo 同一缺口（RIFT-261）。
 *
 * 印刷费用（1 个 Mind 符文，无能量符号）无法按契约记录：3.1 的 KeywordAbility 只有
 * kind / keyword / value，没有承载印刷费用组成的字段（M1 的 long-sword / warmogs-armor
 * 用了契约外的 costDomain 并以 as const 绕开 satisfies 的类型检查）。本卡按契约只声明
 * keyword + 印刷符号数 value，并上报契约变更请求。
 */
export default {
  canonicalCardId: "card.hash-f9773189acce6bbb236b5fe609b108079a3b1b13064783ef685543fb56e8e969",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "Equip 的启动费用无法在费用管线支付：已合入的 Equip 展开（RIFT-87）声明 payments: [{ kind: \"equip\" }]，" +
    "cost/plan-values.ts 的 readCost 对未知支付种类调用 blocked，实测 buildCostPlan 抛 CostPlanError" +
    "（reason \"judge-required\"，message \"Unsupported payment kind: equip\"）；同时缺少卡牌程序 → 关键词展开 → " +
    "时点/链的接线（契约 3.5，RIFT-257）。印刷 Equip 费用为 1 个 Mind 符文（:rb_rune_mind:，无能量符号）；契约 3.1 的 " +
    "KeywordAbility 没有承载印刷费用组成的字段，故只以 value: 1 记录印刷符号数。依赖：Equip 费用支付种类" +
    "（RIFT-261）与 RIFT-257 的关键词/触发接线。不近似实现（不写成裸 effect.attach）。",
  abilities: [
    // 818.1.c：印刷费用为 1 个 Mind 符文（:rb_rune_mind:，无能量符号）；value 记录印刷符号数 1。
    { kind: "keyword", keyword: "equip", value: 1 }
  ],
  sourceText: "[Equip] :rb_rune_mind: (:rb_rune_mind:: Attach this to a unit you control.)"
} satisfies CardProgram;

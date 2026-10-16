import type { CardProgram } from "../../ir/index.js";

/**
 * Cloth Armor (sfd-064-221) — Gear, 1 energy, Might 0, 领域 Mind, 标签 Equipment。
 *
 * sourceText（逐字取自 packages/card-data/data/deck-catalog.json sfd-064-221）：
 *   "[Quick-Draw] (This has [Reaction]. When you play it, attach it to a unit you control.)
 *    [Equip] :rb_rune_mind: (:rb_rune_mind:: Attach this to a unit you control.)"
 *
 * 规则依据（CR v1.5）：
 * - 819.1 / 819.1.b / 819.1.d：Quick-Draw 功能上等于固有 [Reaction] 加打出时的附着触发；
 *   展开由已合入的 effects/keywords/Quick-Draw.ts 负责。
 * - 818.1 / 818.1.a / 818.1.c.2：Equipment 上的 [Equip] 是启动式能力关键词，印刷费用为
 *   1 个 Mind 符文；展开由 effects/keywords/Equip.ts 负责。
 *
 * status = judge-required（与 Sterak's Gage 同源缺口）：
 * 1. Equip 启动费用不可支付：展开声明 payments: [{ kind: "equip" }]，cost/plan-values.ts 的
 *    readCost 对未知支付种类 blocked——实测 buildCostPlan 抛 CostPlanError（reason
 *    "judge-required"，message "Unsupported payment kind: equip"）。
 * 2. Quick-Draw 展开没有消费方：continuous.timing 无图层消费（RIFT-91），也缺少卡牌程序 →
 *    TriggerRegistration 接线（契约 3.5）。
 * 印刷费用（1 个 Mind 符文，无能量符号）无法按契约记录：3.1 的 KeywordAbility 只有
 * kind / keyword / value，没有承载印刷费用组成的字段（M1 的 long-sword / warmogs-armor
 * 用了契约外的 costDomain 并以 as const 绕开 satisfies 的类型检查）。本卡只声明
 * keyword + 印刷符号数 value，费用组成记在注释与 judgeReason 中，并上报契约变更请求。
 */
export default {
  canonicalCardId: "card.hash-4cea7af35d00d653a3ecebd33dde5212a7ce582deb4a293fcdaf8fd6acdd293c",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处依赖未合入：(1) Equip 的启动费用无法在费用管线支付——已合入的 Equip 展开（RIFT-87）" +
    "声明 payments: [{ kind: \"equip\" }]，cost/plan-values.ts 的 readCost 对未知支付种类调用 blocked，实测 " +
    "buildCostPlan 抛 CostPlanError（reason \"judge-required\"，message \"Unsupported payment kind: equip\"）；" +
    "(2) Quick-Draw 展开（CR 819.1.b/819.1.c/819.1.d）的 continuous.timing 静态许可没有图层消费方（RIFT-91），" +
    "card-played 附着触发也没有卡牌程序 → TriggerRegistration 接线（契约 3.5）。" +
    "印刷 Equip 费用为 1 个 Mind 符文（:rb_rune_mind:，无能量符号）；契约 3.1 的 KeywordAbility 没有承载印刷费用" +
    "组成的字段，故只以 value: 1 记录印刷符号数，费用组成保持在注释与 judgeReason 中。依赖：Equip 费用支付种类（RIFT-89 后续）、" +
    "关键词展开接线；不近似实现。",
  abilities: [
    { kind: "keyword", keyword: "quick-draw" },
    // 818.1.c：印刷费用为 1 个 Mind 符文（:rb_rune_mind:，无能量符号）；value 记录印刷符号数 1。
    { kind: "keyword", keyword: "equip", value: 1 }
  ],
  sourceText:
    "[Quick-Draw] (This has [Reaction]. When you play it, attach it to a unit you control.)\n" +
    "[Equip] :rb_rune_mind: (:rb_rune_mind:: Attach this to a unit you control.)"
} satisfies CardProgram;

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
 *   1 个 Mind 符文；展开由已合入的 effects/keywords/Equip.ts 负责。
 *
 * status = judge-required（与 Sterak's Gage 同源缺口）：
 * 1. Equip 启动费用不可支付：展开声明 payments: [{ kind: "equip" }]，cost/plan-values.ts 的
 *    readCost 对未知支付种类 blocked——buildCostPlan 抛 CostPlanError（reason "judge-required"，
 *    message "Unsupported payment kind: equip"）。
 * 2. 印刷的 Mind 符文到不了 KeywordDef.expand：契约 3.1 的 KeywordAbility 只有 kind/keyword/value，
 *    卡牌程序的消费方没有传契约 3.8.3 的 params.cost；本卡只声明 keyword + 印刷符号数 value，
 *    费用组成记在注释与 judgeReason 中。
 * 3. Quick-Draw 的 card-played 附着触发已由 programs/lifecycle.ts + triggers.ts 接线，
 *    continuous.timing 静态许可也已接入 layers/rules（actionTimings → canAct）；
 *    该半段执行证据由展开结构与管线绑定覆盖，剩余缺口只剩上述费用路径。
 */
export default {
  canonicalCardId: "card.hash-4cea7af35d00d653a3ecebd33dde5212a7ce582deb4a293fcdaf8fd6acdd293c",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处依赖未合入：(1) Equip 的启动费用无法在费用管线支付——已合入的 Equip 展开（effects/keywords/Equip.ts）" +
    "声明 payments: [{ kind: \"equip\" }]，cost/plan-values.ts 的 readCost 对未知支付种类调用 blocked，" +
    "buildCostPlan 抛 CostPlanError（reason \"judge-required\"，message \"Unsupported payment kind: equip\"）；" +
    "(2) 印刷 Equip 费用为 1 个 Mind 符文（:rb_rune_mind:，无能量符号），契约 3.1 的 KeywordAbility 没有承载" +
    "印刷费用组成的字段，卡牌程序的消费方也没有传契约 3.8.3 的 params.cost，故只以 value: 1 记录印刷符号数，" +
    "费用组成保持在注释与 judgeReason 中；" +
    "(3) Quick-Draw 展开（CR 819.1.b/819.1.c/819.1.d）的 card-played 附着触发已由 programs/lifecycle.ts " +
    "→ triggers.ts 接线，continuous.timing 静态许可也已接入 layers/rules（actionTimings → canAct）；" +
    "这两半不再构成缺口。" +
    "已合入的 effect.attach 半段与 Quick-Draw 展开结构由 golden 真实执行；剩余费用缺口不近似实现。" +
    "依赖：Equip 费用支付种类、params.cost 接线。",
  abilities: [
    { kind: "keyword", keyword: "quick-draw" },
    // 818.1.c：印刷费用为 1 个 Mind 符文（:rb_rune_mind:，无能量符号）；value 记录印刷符号数 1。
    { kind: "keyword", keyword: "equip", value: 1 }
  ],
  sourceText:
    "[Quick-Draw] (This has [Reaction]. When you play it, attach it to a unit you control.)\n" +
    "[Equip] :rb_rune_mind: (:rb_rune_mind:: Attach this to a unit you control.)"
} satisfies CardProgram;

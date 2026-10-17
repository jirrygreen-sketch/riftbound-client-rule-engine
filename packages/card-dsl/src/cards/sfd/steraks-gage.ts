import type { CardProgram } from "../../ir/index.js";

/**
 * Sterak's Gage (sfd-056-221) — Gear, 3 energy + 2 Calm power, Might 3, 标签 Equipment。
 *
 * sourceText（逐字取自 packages/card-data/data/deck-catalog.json sfd-056-221）：
 *   "[Quick-Draw] (This has [Reaction]. When you play it, attach it to a unit you control.)
 *    [Equip] :rb_rune_calm: (:rb_rune_calm:: Attach this to a unit you control.)"
 *
 * 规则依据（CR v1.5）：
 * - 819.1 / 819.1.b / 819.1.c / 819.1.d：Quick-Draw 是 Triggered Ability 关键词，
 *   功能上等于固有 [Reaction]（819.1.b/c）加「当你打出此牌时，把它附着到你控制的一个
 *   单位」（819.1.d）。展开由已合入的 effects/keywords/Quick-Draw.ts 负责，卡牌层只
 *   声明关键词（README 第 5 节：关键词只声明，不重写）。
 * - 818.1 / 818.1.a / 818.1.b / 818.1.c / 818.1.c.2：本卡带 Equipment 标签，[Equip]
 *   是启动式能力关键词，印刷费用为 1 个 Calm 符文，功能上等于「[费用]: 把此装备附着到
 *   你控制的一个单位」。展开由 effects/keywords/Equip.ts 负责。
 *
 * status = judge-required（2026-10-17 复核）：Equip 的启动费用仍不可执行。
 *
 * - Equip 展开声明 `payments: [{ kind: "equip", … }]`，而 cost/plan-values.ts 的 readCost
 *   对该支付种类直接 blocked，实测 buildCostPlan 抛 CostPlanError
 *   （reason "judge-required"，message "Unsupported payment kind: equip"），启动式能力无法进链。
 * - Quick-Draw 展开的 card-played 附着触发可以注册（已实测 spec 为
 *   { at: "card-played", filter: { event: "card-played", source: { canonicalCardId } } }）。
 * - 但 [Reaction] 时机仍无生产消费方：Quick-Draw 的静态展开用的是 args 键
 *   value/source/scope/permissions，而已合入的 continuous.timing 原语只接受
 *   grants/timings/appliesTo/duration/target/instanceId/executionId。该静态效果虽能注册进
 *   ability 图层，却不带任何 timing grant——layers/rules/query.ts 的 actionTimings
 *   对它返回空数组（golden 实测），programs/play.ts 的 abilitySpeed 也只从关键字名读打出速度。
 * - 同类展开的 Action/Reaction 关键字在静态绑定器里因 `appliesTo: ["card", "activated-ability"]`
 *   被拒绝（实测 "Unsupported static appliesTo [...]"），即速度类关键词展开整体尚未接通。
 *
 * 印刷的 Equip 费用为 1 个 Calm 符文；契约 3.1 的 KeywordAbility 没有承载印刷费用组成
 * 的字段，本卡按现有契约只声明 keyword + value: 1，费用组成保留在注释与 judgeReason 中。
 */
export default {
  canonicalCardId: "card.hash-b9ee923133a3002010f175ddd77b690a710fa21bed8ffaefa29904a936c710ca",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "(1) Equip 的启动费用无法在费用管线支付：Equip 展开声明 payments: [{ kind: \"equip\" }]，" +
    "cost/plan-values.ts 的 readCost 对该支付种类调用 blocked，实测 buildCostPlan 抛 " +
    "CostPlanError（reason \"judge-required\"，message \"Unsupported payment kind: equip\"）。" +
    "(2) Quick-Draw 的 card-played 附着触发已可注册，但 [Reaction] 时机仍无生产消费方：静态展开写入的是 " +
    "value/source/scope/permissions，而已合入的 continuous.timing 只接受 grants/timings/appliesTo/duration/...；" +
    "静态绑定器实测不产生任何 timing 授权，layers/rules/query.ts 的 actionTimings 返回空数组，" +
    "programs/play.ts 的 abilitySpeed 也只从关键字名读打出速度。Action/Reaction 展开同样因 " +
    "appliesTo: [\"card\", \"activated-ability\"] 被静态绑定器拒绝。" +
    "印刷 Equip 费用为 1 个 Calm 符文；契约 3.1 的 KeywordAbility 没有承载印刷费用组成的字段，" +
    "故只以 value: 1 记录印刷符号数。不把 Equip 写成裸 effect.attach，也不手写 Quick-Draw 的附着逻辑。",
  abilities: [
    // 819.1：印刷的 [Quick-Draw] 声明；展开归 effects/keywords/Quick-Draw.ts。
    { kind: "keyword", keyword: "quick-draw" },
    // 818.1.c：印刷费用为 1 个 Calm 符文（:rb_rune_calm:，无能量符号）；value 记录印刷符号数 1。
    { kind: "keyword", keyword: "equip", value: 1 }
  ],
  sourceText:
    "[Quick-Draw] (This has [Reaction]. When you play it, attach it to a unit you control.)\n" +
    "[Equip] :rb_rune_calm: (:rb_rune_calm:: Attach this to a unit you control.)"
} satisfies CardProgram;

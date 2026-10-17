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
 * status = judge-required（两处依赖仍未解决，均不近似实现）：
 * 1. Equip 的启动费用在费用管线里不可支付：Equip 展开声明
 *    `payments: [{ kind: "equip", … }]`，而 cost/plan-values.ts 的 readCost 对未知支付
 *    种类直接 `blocked(...)`——buildCostPlan 仍抛 CostPlanError（reason
 *    "judge-required"，message "Unsupported payment kind: equip"，RIFT-261 费用原语未合入）。
 * 2. 卡牌程序绑定（RIFT-257）已合入：`createProgramBinding`/`attachLifecycle` 会把
 *    Quick-Draw 展开的 card-played 附着触发注册进事件管线；但 Quick-Draw 的
 *    `continuous.timing` 静态许可只由 layers/rules/query.ts 的 actionTimings 读取，
 *    chain/engine.ts 的 canAct 不消费该注册表（无卡牌 static 注册接线），
 *    打出时的 Reaction 时机与附着许可仍未接通。
 * 印刷的 Equip 费用（1 个 Calm 符文）无法按契约记录：3.1 的 KeywordAbility 只有
 * kind / keyword / value，没有可承载「印刷费用由哪些符号组成」的字段（M1 的
 * long-sword / warmogs-armor 用了未在契约里的 costDomain 扩展字段，并以 as const 绕开
 * satisfies 的类型检查）。本卡按契约只声明 keyword + 印刷符号数 value，印刷费用记在注释与
 * judgeReason 里，并在最终回复上报契约变更请求。
 */
export default {
  canonicalCardId: "card.hash-b9ee923133a3002010f175ddd77b690a710fa21bed8ffaefa29904a936c710ca",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处依赖仍未解决：(1) Equip 的启动费用无法在费用管线支付——已合入的 Equip 展开（RIFT-87）" +
    "声明 payments: [{ kind: \"equip\" }]，cost/plan-values.ts 的 readCost 对未知支付种类调用 blocked，实测 " +
    "buildCostPlan 抛 CostPlanError（reason \"judge-required\"，message \"Unsupported payment kind: equip\"）；" +
    "该支付种类属尚未合入的费用原语（RIFT-261）。" +
    "(2) 卡牌程序绑定（RIFT-257）已合入，Quick-Draw 的 card-played 附着触发可由 createProgramBinding/attachLifecycle " +
    "注册；但 Quick-Draw 展开（CR 819.1.b/819.1.c/819.1.d）的 continuous.timing 静态许可以 " +
    "layers/rules/query.ts 的 actionTimings 为唯一消费方，chain/engine.ts 的 canAct 不读取任何已注册的 static 能力，" +
    "打出时的 Reaction 时机许可仍未接通。" +
    "印刷 Equip 费用为 1 个 Calm 符文（:rb_rune_calm:，无能量符号）；契约 3.1 的 KeywordAbility 没有承载印刷费用" +
    "组成的字段，故只以 value: 1 记录印刷符号数，费用组成保持在注释与 judgeReason 中。依赖：RIFT-261（equip 费用支付种类）、" +
    "static 许可接线；不近似实现（不把 Equip 写成裸 effect.attach，也不手写 Quick-Draw 的附着逻辑）。",
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

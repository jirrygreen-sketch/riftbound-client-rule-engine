import type { CardProgram } from "../../ir/index.js";

/**
 * Spinning Axe (sfd-186-221) — Gear, 2 Energy + 1 Power, Might 3 (Fury/Chaos),
 * tags Draven / Equipment / Signature.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, sfd-186-221，逐字）:
 *   [Quick-Draw] (This has [Reaction]. When you play it, attach it to a unit you control.)
 *   [Equip] :rb_rune_rainbow: (:rb_rune_rainbow:: Attach this to a unit you control.)
 *   [Temporary] (If this is unattached, kill it at the start of its controller's Beginning Phase, before scoring.)
 *
 * 规则依据（CR v1.5）：
 * - 819.1.b/819.1.c/819.1.d：[Quick-Draw] 使本卡固有 [Reaction]，并在打出时把它附着到
 *   你控制的一个单位；展开归 effects/keywords/Quick-Draw.ts（契约 3.7），卡只声明关键词。
 * - 818.1/818.1.b/818.1.b.1/818.1.c.2：[Equip] 是启动式能力关键词，功能等价于
 *   「[费用]：把此装备附着到你控制的一个单位」，选择的单位是 Target（契约 3.6）。
 *   印刷费用是 1 点 :rb_rune_rainbow:，即 135.2.e.5.a 的任意域 Power [A]。
 * - 816.1/816.1.b/816.1.c：[Temporary] 是触发能力关键词，功能等价于「在该永久物控制者的
 *   Beginning Phase 开始时、计分前消灭它」。印刷提醒 "If this is unattached" 与 722.1 的
 *   示例一致：附着时本卡印刷规则文本 Inactive（135.4/718.2/724），故消灭只在未附着时触发。
 *
 * status = judge-required（README 第 2 节，逐项列出缺口，不近似实现）：
 * - [Temporary] 的 KeywordDef 已合入（effects/keywords/Temporary.ts），展开体的 effect.kill
 *   也真实执行；但展开出的触发订阅 beginning-start，而 EVENT_PATTERN_TYPES 封闭词表仍不含
 *   beginning-start（events/trigger-spec.ts），events/pipeline.ts 的 registerTrigger 会对该
 *   spec 调 assertTriggerSpec 并抛 TriggerSpecValidationError（invalid-event-type），
 *   因此经 CardProgram 绑定层注册会失败（golden 实测）。
 * - [Equip] 的费用管线缺口：已合入的 Equip 展开声明 payments: [{ kind: "equip" }]，
 *   而 cost/plan-values.ts 的支付种类只有 energy/power/xp/exhaust/discard/recycle/kill/
 *   reveal/spend-buff（golden 实测 buildCostPlan 抛 "Unsupported payment kind: equip"），
 *   该启动费用无法在 Finalize 支付。
 * - [A] 费用可以通过 power payment + 六域 allowedDomains 表达并支付（135.2.e.5.a）。
 *   costDomain: "rainbow" 记录印刷费用；仍缺 programs/keywords.ts 到 params.cost 的
 *   印刷费用传递，以及 Equip 展开到现有 power payment 的转换。
 * - RIFT-359 已给 card-played 补齐 event.source 与印刷特征快照；Quick-Draw
 *   的来源身份过滤现在可命中，golden 通过真实打出、触发、目标选择和附着验证。
 *
 * golden 测试真实执行 Quick-Draw 打出触发与附着，以及 Equip 的 effect.attach 本体，
 * 并为每个剩余缺口保留直接执行证据；
 * 整卡能力仍以 test.todo 标注。
 */
const abilities = [
  // 819.1.d："[Reaction]" 与 "When you play this, attach it to a Unit you control."。
  { kind: "keyword", keyword: "quick-draw" },
  // 818.1.c.2/135.2.e.5.a：费用 1 点任意域 Power，costDomain 保留印刷记号。
  { kind: "keyword", keyword: "equip", value: 1, costDomain: "rainbow" },
  // 816.1.b："kill it at the start of its controller's Beginning Phase, before scoring"。
  { kind: "keyword", keyword: "temporary" }
] as const;

const program = {
  canonicalCardId:
    "card.hash-800c2a2c210066550ce1c729596dd3e463d221242fece59853f3a3983e3023b4",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "三处当前缺口，均不近似实现：" +
    "（1）[Temporary] 的 KeywordDef 已合入（effects/keywords/Temporary.ts），816.1.b/816.1.c 的" +
    "触发体用已合入的 effect.kill 真实执行（golden）；但展开出的触发订阅 beginning-start，而 events/trigger-spec.ts 的 " +
    "EVENT_PATTERN_TYPES 封闭词表仍不含 beginning-start，events/pipeline.ts 注册路径会调 assertTriggerSpec 并抛 " +
    "TriggerSpecValidationError（invalid-event-type，golden 实测）——需要 EventPattern 词表补齐（时点本身已存在）。" +
    "（2）[Equip] 的印刷 [A] 费用按 CR 135.2.e.5.a 可用任意域 Power 支付；现有 power payment + 六域 allowedDomains 已能表达并支付。" +
    "costDomain: \"rainbow\" 保留印刷记号，但 programs/keywords.ts 只向 expand 传 value/host，尚未传递 params.cost。" +
    "（3）已合入的 Equip 展开声明 payments: [{ kind: \"equip\" }]，而 cost/plan-values.ts 的支付种类不含 equip，" +
    "尚未将该声明转换为现有 power payment，启动费用目前无法在 Finalize 支付（golden 实测 CostPlanError \"Unsupported payment kind: equip\"）。" +
    "Quick-Draw 的 event.source 身份已由 RIFT-359 合入，真实 card-played 事件可命中本卡来源过滤，" +
    "golden 通过真实打出、触发进入链、锁定目标和 effect.attach 验证。" +
    "依赖：EventPattern 词表补齐 beginning-start、Equip 印刷费用参数传递与支付种类转换。" +
    "golden 验证 Quick-Draw 的真实打出触发与附着，以及 Equip attach 本体；整卡仍保持 judge-required。",
  abilities,
  sourceText:
    "[Quick-Draw] (This has [Reaction]. When you play it, attach it to a unit you control.)\n" +
    "[Equip] :rb_rune_rainbow: (:rb_rune_rainbow:: Attach this to a unit you control.)\n" +
    "[Temporary] (If this is unattached, kill it at the start of its controller's Beginning Phase, before scoring.)"
} satisfies CardProgram;

export default program;

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
 *   印刷费用是 1 点 :rb_rune_rainbow:，即 135.2.e.5/163.2.b 的任意域（Universal）Power [A]。
 * - 816.1/816.1.b/816.1.c：[Temporary] 是触发能力关键词，功能等价于「在该永久物控制者的
 *   Beginning Phase 开始时、计分前消灭它」。印刷提醒 "If this is unattached" 与 722.1 的
 *   示例一致：附着时本卡印刷规则文本 Inactive（135.4/718.2/724），故消灭只在未附着时触发。
 *
 * status = judge-required（README 第 2 节，逐项列出缺口，不近似实现）：
 * - [Temporary] 的 KeywordDef 已合入（effects/keywords/Temporary.ts，RIFT-264～268 关键词批次），
 *   展开体的 effect.kill 也真实执行；但展开出的触发订阅 beginning-start，而
 *   EVENT_PATTERN_TYPES 封闭词表仍不含 beginning-start（events/trigger-spec.ts），
 *   events/pipeline.ts 的 registerTrigger 会对该 spec 调 assertTriggerSpec 并抛
 *   TriggerSpecValidationError（invalid-event-type），因此经 CardProgram 绑定层注册会失败。
 *   依赖：RIFT-39 的 EventPattern 词表补齐 beginning-start（时点本身已存在）。
 * - [Equip] 的费用管线缺口：已合入的 Equip 展开声明 payments: [{ kind: "equip" }]，
 *   而 cost/plan-values.ts 的支付种类只有 energy/power/xp/exhaust/discard/recycle/kill/
 *   reveal/spend-buff，该启动费用无法在 Finalize 支付（当前真实缺口：Equip 支付种类
 *   仍不在已合入费用管线内）。
 * - [A] 任意域 Power 在契约层不可表示：契约与内核的 Domain 是 Fury/Calm/Mind/Body/Chaos/
 *   Order 六域封闭集合，effect.resources 明确记录 163.2.b 的 Universal Power 不可表达、
 *   绝不用某个域近似。本卡以描述性记号 costDomain: "rainbow" 记录印刷费用。
 * - Quick-Draw 展开的打出触发依赖 event.source 身份：展开 filter 是
 *   source: { canonicalCardId }，而 chain/engine.ts 的 card-played 事件只带 object/player；
 *   events/pipeline-match.ts 只在 event.source 存在时匹配 source 过滤（RIFT-257 的
 *   EventPattern.source 适配仍未拿到载荷）。
 *
 * golden 测试真实执行已合入的两段：Quick-Draw 展开的 effect.attach 本体与 Equip 展开的
 * effect.attach 本体（都以 Finalize 锁定的目标上下文运行）；依赖缺口写成 test.todo。
 */
const abilities = [
  // 819.1.d："[Reaction]" 与 "When you play this, attach it to a Unit you control."。
  { kind: "keyword", keyword: "quick-draw" },
  // 818.1.c.2：费用 1 点 [A]。六域封闭集合无 Universal 值，costDomain 只作描述性记录。
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
    "三处已确认的依赖缺口，均不近似实现：" +
    "（1）[Temporary] 的 KeywordDef 已合入（effects/keywords/Temporary.ts），816.1.b/816.1.c 的" +
    "触发体用已合入的 effect.kill 真实执行（golden）；但展开出的触发订阅 beginning-start，而 events/trigger-spec.ts 的 " +
    "EVENT_PATTERN_TYPES 封闭词表仍不含 beginning-start，events/pipeline.ts 注册路径会调 assertTriggerSpec 并抛 " +
    "TriggerSpecValidationError（invalid-event-type）——依赖 RIFT-39 的 EventPattern 词表补齐（时点本身已存在）。" +
    "（2）[Equip] 的印刷费用 :rb_rune_rainbow: 是 135.2.e.5/163.2.b 的 [A] 任意域（Universal）Power，" +
    "但契约与内核的 Domain 是 Fury/Calm/Mind/Body/Chaos/Order 六域封闭集合，effect.resources 明确记录 Universal Power 不可表达、" +
    "绝不近似成某个具体域；本卡以描述性记号 costDomain: \"rainbow\" 记录印刷费用。" +
    "（3）已合入的 Equip 展开声明 payments: [{ kind: \"equip\" }]，而 cost/plan-values.ts 的支付种类不含 equip，" +
    "该启动费用目前无法在 Finalize 支付（当前真实缺口：Equip 支付种类仍不在已合入费用管线内）。" +
    "另外 Quick-Draw 展开（effects/keywords/Quick-Draw.ts）依赖 card-played 事件携带本卡身份：events/pipeline-match.ts 只在 event.source " +
    "存在时匹配 source 过滤，chain/engine.ts 的 card-played 事件只带 object/player（RIFT-257 的 EventPattern.source 适配）。" +
    "依赖：RIFT-39（EventPattern 词表补齐 beginning-start）、Equip 支付种类的费用管线支持、card-played 事件载荷身份；[A] 属契约级缺口。" +
    "golden 只把已合入的 Quick-Draw attach 与 Equip attach 本体当真执行证据，不据此宣称整卡可执行。",
  abilities,
  sourceText:
    "[Quick-Draw] (This has [Reaction]. When you play it, attach it to a unit you control.)\n" +
    "[Equip] :rb_rune_rainbow: (:rb_rune_rainbow:: Attach this to a unit you control.)\n" +
    "[Temporary] (If this is unattached, kill it at the start of its controller's Beginning Phase, before scoring.)"
} satisfies CardProgram;

export default program;

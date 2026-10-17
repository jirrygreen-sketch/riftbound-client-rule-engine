import type { CardProgram } from "../../ir/index.js";

/**
 * Jinx, Rebel (ogn-202-298) — Unit, 5 energy + 1 Chaos power, Might 5。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ogn-202-298）：
 *   When you discard one or more cards, ready me and give me +1 :rb_might: this turn.
 *
 * 规则依据（CR v1.5）：
 * - 「When you discard one or more cards」：弃牌触发（423.1.b：弃牌产生的触发在弃牌完成后执行；
 *   时点 card-discarded 由 events/action-adapter.ts 发出，payload 里带 batchId 区分同一次弃牌批次）。
 * - 「ready me」：effect.ready 省略 objects 时缺省为 { kind: "source" }，即能力宿主本单位（416）。
 * - 「+1 :rb_might: this turn」：带「本回合」期限的临时 Might 修正（432 属性修正层），
 *   在 317.2.c 的回合结束清理里与所有 “this turn” 效果同时到期。effect.buff 的边界注释
 *   明确临时 Might 修正不属于 CR 702/703 的 Buff 标记，契约把它归 layers 的 continuous.might。
 *
 * 结构（契约 3.1/3.2/3.9）：
 * - 单个 triggered 能力：时点 card-discarded，filter 是「你弃牌」的事件（player: controller）；
 * - body[0] 用已合入的 effect.ready（无参数 = ready me）；
 * - body[1] 用已合入的 continuous.might（RIFT-258）以 appliesTo "self" 注册算术层 +1：
 *   「give me +1 :rb_might: this turn」是自我引用（355.10.d：按特征程序化指定、没有选择过程，
 *   不是目标），因此不声明 TargetSpec；duration "end-of-turn" 在 317.2.c 的回合结束清理到期。
 *
 * status: judge-required。两句效果本体都可在解释器 + 参考内核执行（golden 有真实执行证据）：
 * effect.ready（416）就绪来源；continuous.might + appliesTo self 注册带 end-of-turn 期限的 +1。
 * 整卡仍不可执行：「one or more cards」要求同一次弃牌事件只触发一次（423.1.b 弃牌触发在
 * 弃牌完成后执行），而 card-discarded 按牌逐张发出（payload 带 batchId），TriggerSpec.once
 * 只有 per-turn/per-phase/per-combat/per-showdown/per-chain/per-object/per-game，没有
 * per-batch 去重，按张触发会多触发；触发侧也还没有 CardProgram → TriggerRegistration 的订阅方。
 * 依赖：per-batch 触发去重（events/）与 RIFT-257（卡牌程序绑定）。不近似实现。
 */
const jinxRebel = {
  canonicalCardId: "card.hash-059595a3565959bb085347df8707eaf005ac8c9d516ca7e8cb0802a873d37ab6",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「one or more cards」需要同一次弃牌事件只触发一次（CR 423.1.b：弃牌触发在弃牌完成后执行）：" +
    "card-discarded 时点按牌逐张发出（payload 带 batchId），TriggerSpec.once 只有 " +
    "per-turn/per-phase/per-combat/per-showdown/per-chain/per-object/per-game，没有 per-batch 去重，" +
    "按张触发会多触发；events/trigger-spec.ts 的封闭 EVENT_PATTERN_TYPES 也没有 card-discarded 项，" +
    "触发侧还缺 CardProgram → TriggerRegistration 的订阅方（RIFT-257）。" +
    "「ready me」（effect.ready，416）与「+1 :rb_might: this turn」（continuous.might + appliesTo self + " +
    "end-of-turn 期限，RIFT-258）均已合入并有真实执行测试。" +
    "依赖：card-discarded 的触发事件名/批次语义（events/）与 RIFT-257。不近似实现。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "card-discarded",
        filter: { event: "card-discarded", player: "controller" }
      },
      optional: false,
      body: [
        {
          id: "jinx-rebel.ready-me",
          op: "effect.ready",
          args: {}
        },
        {
          // 「give me +1 Might this turn」— me 是能力来源自身（355.10.d：自我引用不是目标），
          // 由 continuous.might 的 appliesTo "self" 表达；end-of-turn 在 317.2.c 到期。
          id: "jinx-rebel.might-this-turn",
          op: "continuous.might",
          args: {
            amount: { kind: "constant", value: 1 },
            duration: { kind: "constant", value: "end-of-turn" },
            appliesTo: { kind: "constant", value: "self" }
          }
        }
      ]
    }
  ],
  sourceText:
    "When you discard one or more cards, ready me and give me +1 :rb_might: this turn."
} satisfies CardProgram;

export default jinxRebel;

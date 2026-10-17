import type { CardProgram } from "../../ir/index.js";

/**
 * Zaun Warrens (ogn-298-298) — Battlefield, Colorless.
 *
 * sourceText: When you conquer here, discard 1, then draw 1.
 *
 * CR v1.5 anchors:
 * - 383.4.c / 473.2.a: "When you conquer here" is a Conquer Effect.
 * - 423.1 / 423.1.a / 423.4: discarding as part of an effect discards as many
 *   cards as possible; the discarding player chooses which cards.
 * - 359.3.e.11: instructions that can be partially followed are followed as
 *   much as possible and negated otherwise; the rule uses exactly this shape
 *   ("Discard 2, then draw 2") — an empty hand negates the discard and the draw
 *   still happens. The two instructions are therefore NOT linked.
 * - 414.3: "draw 1" is an ordinary draw by the ability controller.
 * - 053.3: "here" is this Battlefield.
 *
 * Status: judge-required for the trigger side only. The merged effect.discard
 * and effect.draw primitives execute the whole body through the interpreter and
 * the reference kernel in the golden test (empty hand, single card, and the
 * chooser path); the conquer timing point is now really emitted by the merged
 * TurnFlow Score wave (payload details.battlefieldId), and the golden drives a
 * real EventPipeline registration to receive it. The ability still cannot run
 * in production because:
 * - no merged subscriber turns a CardProgram's triggered ability into a
 *   TriggerRegistration (card-program binding, RIFT-257, in progress), and
 *   190.6's controller resolution for a Battlefield ability is missing;
 * - 053.3's "here" has no evaluable anchor: the emitted conquer event carries
 *   the Battlefield only as a payload detail (details.battlefieldId) and the
 *   static filter cannot reference the host's runtime location; the here: true
 *   key below is the documented placeholder pending the binding layer's
 *   normalization (the closed trigger vocabulary has no such field).
 * The filter uses the closed EventPattern/PlayerSelector vocabulary for the
 * evaluable parts (event "conquered", player "self" = the ability controller).
 * Nothing here is approximated: the body keeps the printed order without a
 * linkedTo, so 359.3.e.11's "discard negated, draw still resolves" holds.
 */
export default {
  canonicalCardId: "card.hash-7eb7c2878a687bba1f5053f3c775d1f55e01679f4a8124757d2bb0a70b15ad88",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "指令体完全用已合入原语表达并在 golden 中真实执行（effect.discard 数量 1 → effect.draw 数量 1；两条不 linkedTo，对应 359.3.e.11 官方例子" +
    "“Discard 2, then draw 2”：弃牌被否定时抽牌照常结算）；conquer 时点现已由已合入的回合计分流程真实发出" +
    "（turn/flow.ts 的 Score 波，载荷 details.battlefieldId），golden 用真实事件管线注册并收到该事件。阻断只在触发侧：" +
    "① 没有已合入的订阅方把 CardProgram 的 triggered ability 注册成 TriggerRegistration（卡牌程序绑定 RIFT-257 进行中），" +
    "190.6 的战场能力控制者解析缺失；② 053.3 的 here 没有可求值锚点：事件只以 details.battlefieldId 携带战场 id，" +
    "静态 filter 读不到宿主运行时位置，here: true 是等待绑定层归一化的占位键（封闭触发词表没有该字段）；" +
    "filter 的 event/player 已按封闭词表拼写（conquered / self）。依赖：RIFT-257（触发绑定与 here 归一化）。不近似实现。",
  sourceText: "When you conquer here, discard 1, then draw 1.",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "conquer",
        // event "conquered" is the closed EventPattern spelling of the conquer
        // timing point (events/pipeline-match.ts maps conquered -> conquer);
        // "self" is the ability controller (190.6, once the binding layer
        // resolves the Battlefield ability's controller). "here" stays the
        // documented 053.3 placeholder pending the binding layer.
        filter: { event: "conquered", here: true, player: "self" }
      },
      optional: false,
      body: [
        {
          // 423.1.a / 423.4: the controller discards 1, choosing the card.
          // The instruction is NOT linked to the following draw (359.3.e.11).
          id: "zaun-warrens.discard",
          op: "effect.discard",
          args: { amount: { kind: "constant", value: 1 } }
        },
        {
          // 414.3: draw 1; the implicit drawer is the ability controller
          // (190.6.d), which effect.draw's default.
          id: "zaun-warrens.draw",
          op: "effect.draw",
          args: { amount: { kind: "constant", value: 1 } }
        }
      ]
    }
  ]
} satisfies CardProgram;

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
 * chooser path); the conquer timing point is emitted by the TurnFlow Score wave
 * (payload details.battlefieldId), and the golden drives a real EventPipeline
 * registration to receive it. The ability still cannot run in production because
 * programs/filters.ts rejects the 053.3 `here: true` placeholder while translating
 * a CardProgram trigger. The scoring event carries only player and
 * details.battlefieldId, so the binding layer has no source Battlefield location
 * to compare and no 190.6 controller resolution for this trigger.
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
    "“Discard 2, then draw 2”：弃牌被否定时抽牌照常结算）；conquer 时点已由 TurnFlow 的 Score wave 真实发出（载荷 details.battlefieldId），" +
    "golden 也已用真实 EventPipeline 收到该事件（封闭事件词为 conquered）。整卡仍不可执行：程序绑定翻译 trigger.filter 时，programs/filters.ts 对 053.3 的 here: true 抛出 " +
    "“Unsupported filter field here”；Score 事件只有 player 与 details.battlefieldId，没有来源 Battlefield 的运行时位置或 190.6 控制者绑定，" +
    "因此无法把“here”与本战场归一化。不近似实现。",
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

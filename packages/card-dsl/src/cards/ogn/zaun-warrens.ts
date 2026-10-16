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
 * chooser path); the ability cannot execute in production because:
 * - scoring/ (RIFT-76) is not bridged to the chain/events pipeline (RIFT-120):
 *   nothing emits the conquer timing point the trigger subscribes to;
 * - no merged subscriber turns a CardProgram's triggered ability into a
 *   TriggerRegistration, and 190.6's controller resolution for a Battlefield
 *   ability is missing;
 * - the trigger filter uses the sibling battlefield spelling
 *   (here: true / player: "controller") for the 053.3 referent; the engine
 *   trigger-spec validator currently rejects both fields.
 * Nothing here is approximated: the body keeps the printed order without a
 * linkedTo, so 359.3.e.11's "discard negated, draw still resolves" holds.
 */
export default {
  canonicalCardId: "card.hash-7eb7c2878a687bba1f5053f3c775d1f55e01679f4a8124757d2bb0a70b15ad88",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "指令体完全用已合入原语表达并在 golden 中真实执行（effect.discard 数量 1 → effect.draw 数量 1；两条不 linkedTo，对应 359.3.e.11 官方例子" +
    "“Discard 2, then draw 2”：弃牌被否定时抽牌照常结算），阻断只在触发侧：① scoring/（RIFT-76）未接入 chain/events 单管线（RIFT-120），" +
    "没有任何生产者发出 conquer 时点；② 没有已合入的订阅方把 CardProgram 的 triggered ability 注册成 TriggerRegistration，190.6 的战场能力控制者解析缺失；" +
    "③ filter 的 here: true / player: \"controller\" 是同类战场卡占位（053.3 的 here 指代），引擎 trigger-spec 校验器当前不接受（EventPattern 无 here、" +
    "PlayerSelector 无 controller）。依赖：RIFT-76（batch1-scoring）、RIFT-120（batch4-chain-events）之后的 conquer 发射与战场能力注册。不近似实现。",
  sourceText: "When you conquer here, discard 1, then draw 1.",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "conquer",
        filter: { event: "conquer", here: true, player: "controller" }
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
          // (190.6.d), which is effect.draw's default.
          id: "zaun-warrens.draw",
          op: "effect.draw",
          args: { amount: { kind: "constant", value: 1 } }
        }
      ]
    }
  ]
} satisfies CardProgram;

import type { CardProgram } from "../../ir/index.js";

/**
 * The Papertree (sfd-219-221) — Battlefield, Colorless.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, sfd-219-221):
 *   "When you hold here, each player channels 1 rune exhausted."
 *
 * CR v1.5 anchors:
 * - 383.4.d / 383.4.d.1 / 383.4.d.2.b: "When you hold here …" is a Hold
 *   Effect — a Triggered Ability; the closed hold timing point (471.2 /
 *   473.2.b) is the subscription point, and 190.6.a/190.6.d make "you" this
 *   Battlefield's Controller.
 * - 431.1 / 431.2 / 431.2.a / 431.3: Channeling takes runes from the top of a
 *   player's Rune Deck onto the Board; "exhausted" is an entry stipulation
 *   (the default is readied), and a short Rune Deck channels as many as
 *   possible without negating the instruction. effect.channel carries exactly
 *   that stipulation.
 * - "each player" is the set of all players in the game; it is a
 *   programmatic set (355.10.d, not a target) whose membership is decided by
 *   the Mode of Play, and each member each channels for themselves (431.1).
 *
 * Status: judge-required. The hold timing point and `effect.channel` primitive
 * are executable pieces. Two rules bindings remain: the hold trigger must bind
 * its `here` location to the event's battlefieldId, and “each player” needs a
 * player-set iteration that runs one channel action per seat. The body keeps the
 * printed exhausted stipulation and does not silently channel only for the
 * controller.
 */
export default {
  canonicalCardId: "card.hash-4d3a916ba4eb2379af2f90b22c56765b66af29ff69411c03a17ac2e8789cf6c0",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处当前缺口：(1) hold 事件的 details.battlefieldId 还没有与本卡宿主位置绑定的 here/payload-location " +
    "选择器，因此静态 filter 的 here 标记不能在生产触发匹配中求值；(2)“each player channels 1 rune exhausted”" +
    "需要玩家集合迭代，当前 effect.channel 每次只接受一个 PlayerId。hold 时点、触发绑定、effect.channel 的数量和" +
    "exhausted 入场参数均已合入；不把 each-player 占位符缩成控制者单席。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "hold",
        // "here" is this Battlefield (053.3) and "you" its Controller
        // (190.6.d); sibling battlefield programs keep the same placeholder
        // spelling while the payload-location binding is pending.
        filter: { event: "hold", here: true, player: "controller" }
      },
      optional: false,
      body: [
        {
          // "each player channels 1 rune exhausted" (431.1/431.2). The
          // recipient is the whole player set, which the frozen IR cannot
          // name: the constant below is a documented placeholder for the
          // missing per-seat iteration, not a fabricated seat.
          id: "the-papertree.channel-1-rune",
          op: "effect.channel",
          args: {
            player: { kind: "constant", value: "each-player" },
            amount: { kind: "constant", value: 1 },
            exhausted: { kind: "constant", value: true }
          }
        }
      ]
    }
  ],
  sourceText: "When you hold here, each player channels 1 rune exhausted."
} satisfies CardProgram;

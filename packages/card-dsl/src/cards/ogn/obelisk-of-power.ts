import type { CardProgram } from "../../ir/index.js";

/**
 * Obelisk of Power (ogn-284-298) — Battlefield, Colorless.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, ogn-284-298):
 *   "At the start of each player's first Beginning Phase, that player channels
 *    1 rune."
 *
 * CR v1.5 anchors:
 * - 383.1: "at the start of …" begins a Triggered Ability; the Beginning Phase
 *   start is the closed `beginning-start` timing point (315.2.a.1).
 * - 431.1 / 431.2 / 431.3: channeling takes Runes from the top of a player's
 *   Rune Deck onto the board (readied by default; shortfall channels as many as
 *   possible). effect.channel is the merged primitive for that action.
 * - "each player's first Beginning Phase" is a per-player once-per-game window
 *   (not once per turn), and "that player" is the player whose Beginning Phase
 *   started — an event participant, not necessarily the ability controller.
 *
 * Status: judge-required — two independent gaps, none approximated:
 * 1. the frozen TriggerSpec frequency scopes (per-turn / per-phase /
 *    per-combat / per-showdown / per-chain / per-object / per-game) cannot
 *    express "each player's FIRST Beginning Phase";
 * 2. effect.channel channels for the ability controller or a PlayerId value
 *    expression; the IR has no event-player selector, so "that player" cannot
 *    be named. The `"event-player"` value below is a documented placeholder
 *    for the missing selector, not executable data.
 */
const obeliskOfPower = {
  canonicalCardId: "card.hash-ce086003979fccd72098987c591cf3efadb8febe6151a369b53c43afa7c9d9ea",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处缺口：(1) “each player's first Beginning Phase” 是每名玩家对局内一次的频度，契约与 TriggerSpec.once 只有 " +
    "per-turn/per-phase/per-combat/per-showdown/per-chain/per-object/per-game 作用域，无法表达逐玩家 once；" +
    "(2) 接收者是事件玩家 “that player”，而 effect.channel 只能取能力控制者或求值为 PlayerId 的表达式，" +
    "IR 没有事件玩家选择器；程序中的 \"event-player\" 是缺选择器的占位值，不可执行。" +
    "beginning-start 时点、trigger 注册与 effect.channel 原语本身已合入；仍缺「每名玩家首次」的 " +
    "逐玩家 once 频度，以及把触发事件玩家作为 effect.channel 收件人的选择器契约。不近似实现。",
  sourceText: "At the start of each player's first Beginning Phase, that player channels 1 rune.",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "beginning-start",
        filter: { event: "beginning-start", player: "any" }
      },
      optional: false,
      body: [
        {
          id: "obelisk.channel-1-rune",
          op: "effect.channel",
          args: {
            // Placeholder for "that player": the IR event-player selector does
            // not exist (see judgeReason).
            player: { kind: "constant", value: "event-player" },
            amount: { kind: "constant", value: 1 }
          }
        }
      ]
    }
  ]
} satisfies CardProgram;

export default obeliskOfPower;

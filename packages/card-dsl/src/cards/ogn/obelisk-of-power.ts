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
 * Status: judge-required — three independent gaps, none approximated:
 * 1. no merged module emits `beginning-start` into the single event pipeline
 *    (see judgeReason), so the trigger cannot be placed on the chain;
 * 2. the frozen TriggerSpec frequency scopes (per-turn / per-phase /
 *    per-combat / per-showdown / per-chain / per-object / per-game) cannot
 *    express "each player's FIRST Beginning Phase";
 * 3. effect.channel channels for the ability controller or a PlayerId value
 *    expression; the IR has no event-player selector, so "that player" cannot
 *    be named. The `"event-player"` value below is a documented placeholder
 *    for the missing selector, not executable data.
 */
const obeliskOfPower = {
  canonicalCardId: "card.hash-ce086003979fccd72098987c591cf3efadb8febe6151a369b53c43afa7c9d9ea",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口：(1) beginning-start 时点（CR 315.2.a.1）没有被任何已合入模块 emit 进唯一事件管线" +
    "（chain/engine.ts 的 emit 点不含阶段开始），需回合/触发接线任务（RIFT-33 及契约 §7.2 批 5）；" +
    "(2) “each player's first Beginning Phase” 是每名玩家对局内一次的频度，契约与 TriggerSpec.once 只有 " +
    "per-turn/per-phase/per-combat/per-showdown/per-chain/per-object/per-game，无法表达；" +
    "(3) 接收者是事件玩家 “that player”，而 effect.channel 只能取能力控制者或求值为 PlayerId 的表达式，" +
    "IR 没有事件玩家选择器；程序中的 \"event-player\" 是缺选择器的占位值，不可执行。" +
    "原语 effect.channel 本身已合入。需要事件玩家选择器与 each-player-once 频度的契约变更请求，不近似实现。",
  sourceText: "At the start of each player's first Beginning Phase, that player channels 1 rune.",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "beginning-start",
        // oncePerPlayer records the printed frequency; no merged code resolves
        // it (see judgeReason) and the pipeline ignores the key.
        filter: { event: "beginning-start", player: "any", oncePerPlayer: true }
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

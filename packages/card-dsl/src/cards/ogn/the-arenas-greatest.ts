import type { CardProgram } from "../../ir/index.js";

/**
 * The Arena's Greatest (ogn-290-298) — Battlefield, Colorless.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, ogn-290-298):
 *   "At the start of each player's first Beginning Phase, that player gains
 *    1 point."
 *
 * CR v1.5 anchors:
 * - 383.1: "at the start of …" begins a Triggered Ability; the Beginning Phase
 *   start is the closed `beginning-start` timing point (315.2.a.1).
 * - 470.1 / 470.2: Scoring and Gaining Points are distinct; "gain 1 point" is
 *   the Gaining Points process, which the closed GameAction set models with the
 *   `score` action (scoring/ owns the Conquer/Hold scoring windows).
 * - "each player's first Beginning Phase" is a per-player once-per-game window,
 *   and "that player" is an event participant, not the ability controller.
 *
 * Status: judge-required.
 * TurnFlow produces Beginning events and effect.score executes Gaining Points.
 * An empty object filter can subscribe to Beginning; the declared event name
 * is outside EVENT_PATTERN_TYPES. The blocked
 * EventPattern below still records the unsupported oncePerPlayer frequency.
 * It is not consumed as a per-player once-per-game scope, and event-player is
 * not a bound ResolveContext selector.
 */
const theArenasGreatest = {
  canonicalCardId: "card.hash-23d43dc5325dcaca58f58415a7f9046b3d280f3c40d261f5aa7ddbfa1bf72770",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺 beginning-start 的每名事件玩家首个 Beginning Phase 绑定（CR 315.2.a.1、383.1.b）：" +
    "EventPattern 的 EVENT_PATTERN_TYPES 不接受 beginning-start；占位 oncePerPlayer 还会被 programs/filters.ts 拒绝，" +
    "per-game 频度按登记/来源计次，不能表示每名事件玩家各一次。" +
    "effect.score 的 event-player 只是未绑定字面量，ResolveContext 没有触发事件玩家选择器，" +
    "无法把 Gaining Points（470.1/470.2）交给 that player；不能替换成控制者。",
  sourceText: "At the start of each player's first Beginning Phase, that player gains 1 point.",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "beginning-start",
        // oncePerPlayer records the printed frequency; no merged code resolves
        // it; the program translator rejects this placeholder key.
        filter: { event: "beginning-start", player: "any", oncePerPlayer: true }
      },
      optional: false,
      body: [
        {
          id: "arenas-greatest.gain-1-point",
          // The primitive is merged; its recipient still needs event binding.
          op: "effect.score",
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

export default theArenasGreatest;

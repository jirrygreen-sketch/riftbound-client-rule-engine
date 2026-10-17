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
 * Program binding is merged, but EventPattern has no beginning-start event
 * discriminant/phase adapter. oncePerPlayer is not consumed as a per-player
 * once-per-game scope; event-player is not a bound ResolveContext selector.
 */
const theArenasGreatest = {
  canonicalCardId: "card.hash-23d43dc5325dcaca58f58415a7f9046b3d280f3c40d261f5aa7ddbfa1bf72770",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "effect.score 已合入，可执行 CR 470.1/470.2 的 Gaining Points，beginning-start 也已由 TurnFlow " +
    "产生（315.2.a.1）。CardProgram 触发绑定已合入，但 EventPattern 不接受 beginning-start 事件名，尚缺阶段事件适配；“each " +
    "player's first Beginning Phase” 还缺每名玩家对局内一次的频度，当前 oncePerPlayer 字段无消费方。接收者 “that " +
    "player” 需要事件玩家选择器：ResolveContext 未暴露触发事件玩家，event-player 仍为未绑定占位，不能用控制者代替。不近似实现。",
  sourceText: "At the start of each player's first Beginning Phase, that player gains 1 point.",
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

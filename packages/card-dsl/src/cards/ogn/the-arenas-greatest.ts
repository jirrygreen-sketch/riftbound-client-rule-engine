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
 * Status: judge-required — effect.score now executes Gaining Points
 * (470.1/470.2), with golden coverage for a concretely bound recipient.
 * Remaining gaps, none approximated:
 * 1. no merged turn module emits `beginning-start` into the single event pipeline,
 *    so the trigger cannot enter the chain;
 * 2. the frequency scopes cannot express "each player's FIRST Beginning Phase",
 *    and the IR has no event-player selector for "that player".
 */
const theArenasGreatest = {
  canonicalCardId: "card.hash-23d43dc5325dcaca58f58415a7f9046b3d280f3c40d261f5aa7ddbfa1bf72770",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "effect.score 已合入，可执行 CR 470.1/470.2 的 Gaining Points；整卡仍有两处缺口：" +
    "(1) beginning-start 时点（CR 315.2.a.1）尚需回合模块接入唯一事件管线，触发器无法自动进链" +
    "（需回合/触发接线，RIFT-33 及契约 §7.2 批 5）；(2) “each player's first Beginning Phase” 是每名玩家" +
    "对局内一次的频度，TriggerSpec.once 的七个范围无法表达；接收者 “that player” 也没有事件玩家选择器。" +
    "程序中的 \"event-player\" 仍为未绑定选择器的占位，不能用控制者代替；不近似实现。",
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

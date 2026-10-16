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
 * Status: judge-required — three merged gaps, none approximated:
 * 1. no merged instruction submits the `score` action: the closed GameAction
 *    set has `score` and the survey lists `effect.score` as a required
 *    primitive, but effects/instructions/ has no file for it (the survey also
 *    records it as one of the blocking primitives);
 * 2. no merged module emits `beginning-start` into the single event pipeline,
 *    so the trigger cannot enter the chain;
 * 3. the frequency scopes cannot express "each player's FIRST Beginning Phase",
 *    and the IR has no event-player selector for "that player".
 */
const theArenasGreatest = {
  canonicalCardId: "card.hash-23d43dc5325dcaca58f58415a7f9046b3d280f3c40d261f5aa7ddbfa1bf72770",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口：(1) 缺得分原语：CR 470.1/470.2 的 Gaining Points 对应封闭 GameAction score，" +
    "但 effects/instructions/ 没有 effect.score 文件（RIFT-9 原语清单将其列为必需原语，" +
    "docs/plans/survey/ability-templates.md 记为阻断项），卡程序无法提交得分动作；" +
    "(2) beginning-start 时点（CR 315.2.a.1）没有被任何已合入模块 emit 进唯一事件管线，触发器无法进链" +
    "（需回合/触发接线，RIFT-33 及契约 §7.2 批 5）；(3) “each player's first Beginning Phase” 是每名玩家" +
    "对局内一次的频度，TriggerSpec.once 的七个范围无法表达；接收者 “that player” 也没有事件玩家选择器。" +
    "程序中的 effect.score 与 \"event-player\" 均为缺失原语/选择器的占位，不可执行；不近似实现。",
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
          // Unregistered placeholder for the missing effect.score primitive
          // (see judgeReason); not executable data.
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

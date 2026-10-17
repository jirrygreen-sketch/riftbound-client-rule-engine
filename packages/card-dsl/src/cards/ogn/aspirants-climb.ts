import type { CardProgram } from "../../ir/index.js";

/**
 * Aspirant's Climb (ogn-276-298) — Battlefield, domainless.
 *
 * "Increase the points needed to win the game by 1."
 *
 * CR v1.5 anchors:
 * - 194.2: a player wins in a cleanup with points greater than or equal to the
 *   Victory Score and more points than any other player.
 * - 194.3: the Victory Score is 8 points by default; 194.3.a allows game modes
 *   or card effects to alter it (485.3.a: Victory Scores can be any positive
 *   number).
 * - 190.6.a / 190.6.d: the ability belongs to the battlefields' controller;
 *   "you" is that controller. The printed "the points needed to win the game"
 *   is the Victory Score, a game-mode-level value, not a player's points
 *   (470.1 / 473.1 add points; this text changes the threshold instead).
 *
 * Status: judge-required. Static binding exists, but no card-facing opcode
 * or layer rule changes Victory Score. setDuelVictoryScoreForEffect changes
 * independent scoring state; it does not bind, stack, or remove this static
 * battlefield effect in TurnFlow. abilities stays empty until that rule
 * operation and lifecycle exist (194.3.a / 485.3.a).
 */
export default {
  canonicalCardId: "card.hash-fcad8933f7d202b4257c42152d9db853ca4833cb50e75d63d54ab0462883e34d",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺卡牌可绑定的 Victory Score 连续规则修改（CR 194.3.a/485.3.a）：effect.score 只加玩家分数，effect.win 只宣告胜者；没有可增加获胜阈值的 opcode 或 layer rule，也未接入 TurnFlow 的 victoryScore。scoring/setDuelVictoryScoreForEffect 仅修改独立计分状态，不能提供本战场静态效果的叠加和撤销。The static binding is merged; it still needs a Victory Score rule operation and lifecycle integration.",
  sourceText: "Increase the points needed to win the game by 1.",
  abilities: []
} satisfies CardProgram;

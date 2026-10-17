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
 * Status rationale (contract §3.1, cards README §2): the frozen effect surface
 * still has no operation that changes the Victory Score. The closed GameAction
 * set (contract §3.6) has `score` and `win` but nothing that raises the win
 * threshold; `effect.score` (RIFT-115) awards points, a different event, and
 * `effect.win` declares a winner. The engine does model the value
 * (scoring/setDuelVictoryScoreForEffect, CR 194.3.a, internal-only), but no
 * card-facing opcode, IR kind or validation shape is merged for it, and
 * inventing one here is exactly the approximation the judge-required rule
 * forbids, so `abilities` stays empty. The RIFT-257 static binding is merged
 * (programs/statics.ts), so a static ability could be bound once a
 * victory-score operation exists.
 */
export default {
  canonicalCardId: "card.hash-fcad8933f7d202b4257c42152d9db853ca4833cb50e75d63d54ab0462883e34d",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "No merged operation changes the Victory Score: the closed GameAction set (contract 3.6) exposes `score` (point gain, CR 470/473.1) and `win` (CR 195/196) but no victory-threshold change, and no instruction file or IR ability kind exists for CR 194.3.a 'card effects may alter the Victory Score'. The engine models the value internally (scoring/setDuelVictoryScoreForEffect) without a card-facing primitive, so the effect is not encoded rather than approximated with point gain. The static binding is merged (programs/statics.ts); the only dependency is a new victory-score primitive (contract change request).",
  sourceText: "Increase the points needed to win the game by 1.",
  abilities: []
} satisfies CardProgram;

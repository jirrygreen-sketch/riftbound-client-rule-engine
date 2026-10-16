import type { CardProgram } from "../../ir/index.js";

/**
 * Forgotten Monument (sfd-209-221) — Battlefield, SFD.
 *
 * "Players can't score here until their third turn."
 *
 * Rules anchors (Core Rules v1.5):
 * - Scoring is the act of a player seizing or maintaining control of a
 *   battlefield they have not yet scored this turn (470.1, 471.1/471.2);
 *   470.3 is why the card text uses "score" without naming "points".
 * - The printed window is a per-player, turn-count-based prohibition attached
 *   to one battlefield location: no player may score at this battlefield
 *   until that player's third turn (a static restriction, not a trigger and
 *   not a score replacement). It is not a "while you control" ability, so it
 *   is not conditioned on the battlefield's controller (contrast 190.6.d).
 * - The ability is a restriction on the Scoring process itself, which the
 *   scoring module owns (packages/engine-core/src/scoring/scoring.ts; the
 *   scoring authority never consults card data for such restrictions today).
 *
 * Status rationale (contract 3.1): there is no `continuous.restrict`
 * primitive / scoring-restriction consumer merged, there is no per-player
 * turn-counter condition available to card IR (`condition.history` exposes
 * action/timing-point history, not "this is that player's third turn"), and
 * 190.6.d does not apply because the text names no controller. Writing a
 * trigger, a replacement, or a score-prevention instruction would invent
 * semantics, so the card is judge-required and the static restriction shape
 * below is kept for review only. `continuous.restrict` is a tracked new
 * primitive (docs/plans/survey/ability-templates.md §27).
 */
export default {
  canonicalCardId: "card.hash-b6280b20779b152b78ff7c32ddd405d6d7c490bb00b2e8939b821030dffcab90",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺 continuous.restrict 静态限制原语与 scoring 消费方（禁止在指定战场计分；470.1/471 的 Scoring 流程属 scoring 模块，现不读取卡牌限制），" +
    "且 IR 无「某玩家的第三回合」条件：condition.history 只查动作/时点数，没有按玩家回合序数的谓词，" +
    "无法真实表达 'until their third turn'；不近似实现。",
  sourceText: "Players can't score here until their third turn.",
  abilities: [
    {
      kind: "static",
      effect: {
        kind: "continuous.restrict",
        restriction: "score",
        appliesTo: "this-battlefield",
        until: { perPlayerTurn: 3 }
      }
    }
  ]
} satisfies CardProgram;

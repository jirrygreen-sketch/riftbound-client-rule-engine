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
 * Status rationale (contract 3.1): judge-required, current gaps:
 * 1. the merged `continuous.restrict` primitive (RIFT-259) registers the
 *    prohibition and layers/rules/query.restrictions() can read it, but the
 *    scoring flow (scoring/scoring.ts) never consults that registry — nothing
 *    reads a score restriction at Scoring time, and the card-static → layers
 *    registration path is RIFT-257's binder hook rather than an end-to-end
 *    consumer;
 * 2. the printed window "until their third turn" is a per-player turn-count
 *    predicate: card IR exposes counting via condition.history (action /
 *    timing-point history) and object filters, but no turn-ordinal vocabulary
 *    for "that player's third turn", so the window is not evaluable.
 * Writing a trigger, a replacement, or a score-prevention instruction would
 * invent semantics, so the static restriction shape below is kept for review
 * only; the golden executes the merged primitive's registration and the
 * restriction query as isolated evidence.
 */
export default {
  canonicalCardId: "card.hash-b6280b20779b152b78ff7c32ddd405d6d7c490bb00b2e8939b821030dffcab90",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处当前缺口：(1) continuous.restrict 原语（RIFT-259）已合入且 layers/rules/query.restrictions() 可读，" +
    "但 scoring 流程（scoring/scoring.ts）从不查询该注册表——计分时没有任何读取得分限制的调用方，" +
    "卡牌 static → 图层的注册入口也仍是 RIFT-257 的 binder 钩子而非端到端消费方；" +
    "(2) 「until their third turn」是按玩家的回合序数窗口：卡牌 IR 只有 condition.history（动作/时点计数）" +
    "与对象过滤器，没有「某玩家的第三回合」词表，窗口不可求值。不近似实现（不写触发、不写替代、不写禁止计分指令）。",
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

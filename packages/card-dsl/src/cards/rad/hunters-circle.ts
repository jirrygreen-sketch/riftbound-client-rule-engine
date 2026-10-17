import type { CardProgram } from "../../ir/index.js";

/**
 * Hunters' Circle (rad-163-167) — Battlefield, Colorless.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, rad-163-167):
 *   "For each player, the first unit or gear they play here on their turn
 *    costs :rb_energy_1: less."
 *
 * CR v1.5 anchors:
 * - 190.6.a / 190.6.d: control of a Battlefield determines control of its
 *   abilities; "they" is each player playing the card, not a single controller.
 *   The ability therefore applies for every player, not only for the
 *   Battlefield's controller (the printed "For each player" makes this
 *   explicit, 356.4.a allows a discount to be applied by any card or effect).
 * - 356.4 / 356.4.a / 356.4.b / 356.4.f: "costs [1] less" is a discount
 *   applied to the total cost while playing the card; discounts may reduce the
 *   cost to 0 and apply to additional costs as well.
 * - 349 / 356: the discount is evaluated while building that play's cost plan,
 *   not as an instruction that resolves in the chain.
 * - "the first unit or gear they play here on their turn" is a per-turn,
 *   per-player one-shot window over the first qualifying play: the card is
 *   played to this Battlefield ("here", 053.3) and it must be the player's
 *   first such play that turn.
 *
 * Status (cards/README.md §2): judge-required. The discount value itself is
 * denotable by the merged cost-plan model (buildCostPlan applies announced
 * `discounts`), but the card cannot install it, because two pieces are
 * missing:
 * 1. no current program-to-cost path registers a discount on a *future* play
 *    or turns this static ability into that play's CostPlanInput.
 * 2. the "first … on their turn" window needs a per-player, per-turn one-shot
 *    gate over plays to this Battlefield; the frozen Condition/HistoryQuery
 *    model has no "card was played to this location" predicate and no
 *    per-player one-shot window, and a continuous effect would otherwise
 *    discount every qualifying play, which is not what the card says.
 * The static ability below is the closest structurally honest encoding: it
 * records the -1 energy delta and the unit-or-gear population without claiming
 * the one-shot window exists. The golden test proves the discount arithmetic on
 * a real merged cost plan (3 energy → 2 for one qualifying play, and no
 * negative cost) instead of asserting that the card installs it.
 * Dependencies: a static-program-to-CostPlan binding and a per-player
 * first-play history gate with a location predicate.
 */
export default {
  canonicalCardId: "card.hash-7737d765f33a7c1065a7cc21af4afc511f86a348b9bfcda04f685a4478b48ffd",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "当前缺口：(1) programs/statics 未把 cost.modify 转为后续打出的 CostPlanInput.discounts；" +
    "(2)「the first unit or gear they play here on their turn」需在费用计算前判定每名玩家自己回合的首次打出到本战场。" +
    "HistoryQuery 已有 player/scope/objectFilter，但没有 play destination 谓词；Condition 也不能读取该历史计数，" +
    "per-turn-first-play 尚无消费方。已合入的地点选择与普通条件求值不能代替这个历史/费用绑定。",
  sourceText:
    "For each player, the first unit or gear they play here on their turn costs :rb_energy_1: less.",
  abilities: [
    {
      kind: "static",
      effect: {
        // Discount kind/field names follow the merged cost-plan model
        // (CostPlanInput.discounts → CostDiscount{resource, amount}); the
        // per-player one-shot window is the judged part (see judgeReason).
        kind: "cost.modify",
        resource: "energy",
        amount: { kind: "constant", value: -1 },
        duration: "per-turn-first-play",
        appliesTo: "play-cost",
        filter: {
          type: ["unit", "gear"],
          controller: "controller",
          sameLocationAs: "self"
        }
      },
      condition: { kind: "always" }
    }
  ]
} satisfies CardProgram;


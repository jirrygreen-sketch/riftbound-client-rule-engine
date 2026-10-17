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
 * `discounts`), but the card cannot install it, because three pieces are
 * missing:
 * 1. cost.modify/cost.pay are still the RIFT-261 workstream: no instruction
 *    file registers a discount on a *future* play, and no merged path turns a
 *    card program's static ability into the later play's CostPlanInput.
 * 2. no merged consumer expands a CardProgram static ability into a
 *    ContinuousEffectSpec (layers/ only consumes registrations made through
 *    ResolveContext.addContinuous) — the RIFT-257 card-program binding.
 * 3. the "first … on their turn" window needs a per-player, per-turn one-shot
 *    gate over plays to this Battlefield; the frozen Condition/HistoryQuery
 *    model has no "card was played to this location" predicate and no
 *    per-player one-shot window, and a continuous effect would otherwise
 *    discount every qualifying play, which is not what the card says.
 * The static ability below is the closest structurally honest encoding: it
 * records the -1 energy delta and the unit-or-gear population without claiming
 * the one-shot window exists. The golden test proves the discount arithmetic on
 * a real merged cost plan (3 energy → 2 for one qualifying play, and no
 * negative cost) instead of asserting that the card installs it.
 * Dependencies: RIFT-261 (cost.modify/cost.pay), RIFT-257 (card-static binding)
 * and a per-player first-play history gate.
 */
export default {
  canonicalCardId: "card.hash-7737d765f33a7c1065a7cc21af4afc511f86a348b9bfcda04f685a4478b48ffd",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口，均不近似实现：(1) 缺少把减费安装到未来打出的原语：cost.modify/cost.pay 仍属 RIFT-261，" +
    "effects/instructions/ 没有对应 op 文件，也没有已合入路径把 CardProgram 的 static 能力转成后续那次打出 CostPlanInput 的 discounts" +
    "（cost/buildCostPlan 接受 discounts，但只作用于单次调用方提供的计划）。" +
    "(2) 没有已合入消费方把 CardProgram 的 static 能力注册成 ContinuousEffectSpec（layers 只消费 ResolveContext.addContinuous 的注册，RIFT-257）。" +
    "(3)「the first unit or gear they play here on their turn」是一次性窗口：需要每名玩家、每回合的首次「打出到本战场」历史判定，" +
    "而 Condition/HistoryQuery 没有「卡牌被打出到该地点」谓词，也没有 per-player one-shot 窗口形状；" +
    "写成常驻持续效果会给本回合后续每一次符合条件的打出都减费，与卡面不符。" +
    "依赖：RIFT-261、RIFT-257 与 per-player first-play 历史门控。",
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


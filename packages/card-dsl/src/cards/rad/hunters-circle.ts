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
 * Status (cards/README.md §2, 2026-10-18 recheck): judge-required. The discount
 * value, the unit-or-gear population and the "first … on their turn" window are
 * executable in the merged collector (cost/discounts/collect.ts, RIFT-709): the
 * declaration below uses that collector's accepted field set and golden measures
 * 3 → 2 for the first qualifying play, full cost for the next one, and an
 * untouched cost for a spell. Three pieces are still missing, so the card cannot
 * install it on a real play:
 * 1. no program-to-cost path registers a discount on a *future* play. The
 *    production binder rejects the declaration before any cost is built:
 *    programs/statics.ts `staticTarget` throws "Unsupported static appliesTo
 *    \"play-cost\"", and `layerFor` throws "has no layer mapping" once the scope
 *    is renamed, so nothing reaches the collector. chain/engine.ts's Finalize
 *    still calls buildCostPlan directly; finalizeCostPlan only runs when a
 *    caller supplies `sources` (the module's own README lists the statics
 *    routing and Finalize wiring as open integration requests).
 * 2. "they play here" needs the play *destination*, and the declaration keeps
 *    the printed anchor `sameLocationAs: "self"` for exactly that. A Battlefield
 *    permanent has no `location`, so the collector fails closed with
 *    "Cost location anchor has no location; play destination binding is
 *    required" (measured), and the finalized-play history cannot supply it
 *    either: a FinalizedCardPlay snapshot is taken at Finalize, when a card
 *    played to a Battlefield is still on the Chain with `location: null`
 *    (observed: chain-item-finalize carries `zone: "hand"`,
 *    `location: null`).
 * 3. "For each player" needs a payer-relative player selector. The collector
 *    resolves `filter.controller` against the ability's source, so
 *    `controller: "controller"` means "controlled by this Battlefield's
 *    controller"; there is no spelling for "the player playing the card", and
 *    dropping the field to buy one player would silently discount the other
 *    (measured: with only the 'here' anchor removed, the controller's first
 *    unit is 3 → 2 while a non-controller's first unit stays 3).
 * The golden asserts every part that is executable today: the destination
 * anchor fails closed, and with only that anchor removed (nothing else changed)
 * the announced −1 discount, the unit/gear population and the per-turn
 * one-shot window all execute.
 * Dependencies: a static-program-to-CostPlan binding (statics routing + a
 * chain/engine.ts Finalize that calls finalizeCostPlan) and a play-destination
 * snapshot on the finalized-play history.
 */
export default {
  canonicalCardId: "card.hash-7737d765f33a7c1065a7cc21af4afc511f86a348b9bfcda04f685a4478b48ffd",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "2026-10-18 复核：减费量、unit/gear 范围与「first … on their turn」窗口本身已可执行——" +
    "cost/discounts/collect.ts 的 finalizeCostPlan 消费 continuous.cost-modification 的 " +
    "appliesTo=\"play-cost\"、duration=\"per-turn-first-play\" 与过滤器，golden 实测（仅去掉印刷的 here 锚点）" +
    "首次 3→2、第二次恢复 3、spell 不减费。仍缺三处：(1) 生产路径不安装本声明——programs/statics.ts 的 staticTarget 抛 " +
    "Unsupported static appliesTo \"play-cost\"，layerFor 对 continuous.cost-modification 抛 " +
    "no layer mapping，chain/engine.ts 的 Finalize 只调用 buildCostPlan，不调用 finalizeCostPlan 收集场上 static，" +
    "因此收集器只能由调用者显式传 sources。(2)「they play here」缺打出目的地绑定：" +
    "印刷锚点 sameLocationAs:\"self\" 在战场上没有 location，收集器实测抛 " +
    "CostPlanError\"Cost location anchor has no location; play destination binding is required\"；" +
    "finalizedPlaysThisTurn 也补不上——它是 Finalize 时的快照，此时被播放的牌仍在 Chain 上、" +
    "location 为 null（实测 chain-item-finalize：zone=hand、location=null）。(3)「For each player」缺" +
    "付费者相对的玩家选择符：收集器把 filter.controller 相对能力来源解析，" +
    "controller:\"controller\" 等于「本战场控制者打出的牌」，没有「打出这张牌的玩家」的拼写；" +
    "实测仅去掉 here 锚点时，本战场控制者首次 3→2，而另一名玩家的首次仍为 3。" +
    "不近似实现：不把 \"here\" 丢掉当作无条件减费。",
  sourceText:
    "For each player, the first unit or gear they play here on their turn costs :rb_energy_1: less.",
  abilities: [
    {
      kind: "static",
      effect: {
        // Field names follow the merged collector's accepted vocabulary
        // (kind/resource/amount/appliesTo/filter/duration, 356.4). "here" is
        // the missing destination half described in judgeReason.
        kind: "continuous.cost-modification",
        resource: "energy",
        amount: { kind: "constant", value: -1 },
        duration: "per-turn-first-play",
        appliesTo: "play-cost",
        filter: {
          type: ["unit", "gear"],
          controller: "controller",
          // 053.3 的 "here"：必须绑定打出目的地（见 judgeReason 第 2 条），
          // 战场上没有 location 时 fail-closed，绝不当成无条件减费。
          sameLocationAs: "self"
        }
      },
      condition: { kind: "always" }
    }
  ]
} satisfies CardProgram;


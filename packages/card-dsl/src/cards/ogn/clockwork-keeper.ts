import type { CardProgram } from "../../ir/index.js";

/**
 * Clockwork Keeper (ogn-044-298) — Unit, 2 energy, Might 2, Calm, Shurima.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, ogn-044-298):
 *   As you play me, you may pay :rb_rune_calm: as an additional cost. If you
 *   do, draw 1.
 *
 * Rules evidence (Core Rules v1.5):
 * - "As you play me" choices or actions are made now, while the card is being
 *   played (355.1); 355.1.a includes the decision whether to pay an Optional
 *   Additional Cost. The cost itself uses the phrase "as an additional cost"
 *   with "may", i.e. an Optional Additional Cost (356.2.b, 356.2.b.1) paid in
 *   the cost steps (350.3, 356.2).
 * - The payment is one Calm rune of Power. The card data prints `power: null`
 *   (no printed power cost), which must not be rewritten to 0; the additional
 *   cost is a separate, optional component.
 * - 356.4.f.1: an optional additional cost counts as "paid" if the player made
 *   the decision to pay it, regardless of how much was actually paid (the rules
 *   use this very card as the example). "If you do, draw 1" therefore keys off
 *   the decision/receipt, not off any resource delta.
 *
 * Status: judge-required. Two gaps, neither approximated:
 * - The merged cost pipeline, optional additional-cost kind, and `cost.pay`
 *   instruction all exist, but programs/play.ts rejects CardProgram
 *   `additional-cost`/`optional` fields before producing a CostPlanInput. No
 *   production binding turns this declaration into the optional payment input.
 * - "If you do" needs the paid/declined receipt at resolution (356.4.f.1); the
 *   frozen IR has no cost-result binding (the survey lists it as
 *   condition.result) so the conditional draw cannot be gated.
 * The single effect.draw (414.3) half is merged and is executed by the golden
 * test.
 */
export default {
  canonicalCardId: "card.hash-de653e6834bc37f0789f5440ed9c70c08e828432f917783a5f0277fa9ceed1a0",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「As you play me, you may pay :rb_rune_calm: as an additional cost. If you do, draw 1.」需要可选追加费用的卡牌侧收取与回执：" +
    "355.1.a/356.2.b/356.2.b.1 规定该费用在打出流程的 Finalize 决定并支付。已合入的 cost/ 虽接受 Optional Additional Cost，" +
    "但 programs/play.ts 仍拒绝 CardProgram 的 additional-cost/optional 字段，未把卡牌声明接进 CostPlanInput.optionalAdditional；" +
    "cost.pay 与追加费用 kind 已存在，缺的是这条卡牌到费用计划的生产绑定；" +
    "356.4.f.1 的「If you do」以「玩家决定支付」为凭证（与实付数额无关），冻结 IR 没有费用结果绑定（调研记为 condition.result），" +
    "因此条件抽牌无法判定。依赖：CardProgram → CostPlanInput 绑定与费用结果回执表达。不近似实现，不用无条件 draw 冒充。" +
    "Draw 1 本体（effect.draw，414.3）已合入并在 golden 中真实执行。",
  abilities: [
    {
      kind: "play",
      // "as an additional cost" + "may" = Optional Additional Cost
      // (356.2.b.1); one Calm rune of Power. Declared so reviewers can see the
      // printed component, pending the CardProgram → CostPlanInput binding and
      // the paid receipt the conditional draw needs.
      cost: {
        kind: "additional-cost",
        optional: true,
        power: { kind: "constant", value: ["Calm"] }
      },
      body: [
        {
          // "draw 1" is conditional on the optional additional cost having been
          // chosen (356.4.f.1); the receipt binding is unmerged (judgeReason).
          id: "clockwork-keeper.draw-1",
          op: "effect.draw",
          args: { amount: { kind: "constant", value: 1 } }
        }
      ]
    }
  ],
  sourceText: "As you play me, you may pay :rb_rune_calm: as an additional cost. If you do, draw 1."
} satisfies CardProgram;

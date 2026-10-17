import type { CardProgram } from "../../ir/index.js";

/**
 * Marai Spire (sfd-211-221) — Battlefield, SFD.
 *
 * "While you control this battlefield, friendly [Repeat] costs cost
 *  :rb_energy_1: less."
 *
 * Rules anchors (Core Rules v1.5):
 * - "While you control this battlefield" is the controller window of a
 *   battlefield ability: 190.6.a gives the controller its abilities and
 *   190.6.d makes "you" the battlefield's controller.
 * - The affected cost is the additional cost of the [Repeat] keyword (820.1,
 *   820.1.a/820.1.c). "cost [1] less" is a discount (356.4, 356.4.b); it can
 *   reduce additional costs, including to 0 (356.4.f). 356.6 floors Energy
 *   and Power at 0, and 204.4's applied-cost distinction does not apply (this
 *   is a discount on Repeat's additional cost).
 * - The discount applies only to the Repeat instances on friendly spells and
 *   abilities (the printed cost belongs to the card/ability carrying Repeat,
 *   per 820.1.c and 820.4), so the static effect filters friendly Repeat
 *   sources rather than granting Repeat to anything.
 *
 * Status rationale: the Repeat KeywordDef and the merged cost.modify/cost.pay
 * cost.modify/cost.pay primitives are merged, but two consumers are still
 * missing: (1) the merged static binder (programs/statics.ts) rejects this card's
 * `appliesTo: "repeat-additional-cost"` (only the generic static layers are
 * mapped, and cost plans are not one of them), so the discount never reaches a
 * Finalize cost plan (the plan only applies caller-supplied discounts), and
 * (2) Repeat's `repeat.cost` declaration has no Finalize collector, so the
 * discount has no target cost to modify. The static effect below records the
 * intended scope and delta; nothing is approximated and no cost is silently
 * rewritten in card data.
 */
export default {
  canonicalCardId: "card.hash-e00a3fe8d0f18d062b1743d6d5d1eb534e884d83303af037d7c1d05c3a6a21bd",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "Repeat 关键词展开与已合入的 cost.modify/cost.pay 原语均已合入，但仍缺两个消费方：" +
    "(1) 已合入的 static 绑定（programs/statics.ts）拒绝本卡的 appliesTo \"repeat-additional-cost\"，卡牌 static cost 效果接不进 Finalize 费用计划" +
    "（cost/cost-plan.ts 只应用调用方显式传入的 discounts）；" +
    "(2) Repeat 展开出的 repeat.cost 没有 Finalize 收取方，本减费没有可修改的目标费用（356.4/356.4.b/356.4.f）。不近似减费。",
  sourceText: "While you control this battlefield, friendly [Repeat] costs cost :rb_energy_1: less.",
  abilities: [
    {
      kind: "static",
      effect: {
        kind: "cost.modify",
        value: { kind: "constant", value: { energy: -1 } },
        appliesTo: "repeat-additional-cost",
        filter: {
          keyword: "Repeat",
          controller: "self",
          zone: "board"
        }
      },
      condition: { kind: "always" }
    }
  ]
} satisfies CardProgram;

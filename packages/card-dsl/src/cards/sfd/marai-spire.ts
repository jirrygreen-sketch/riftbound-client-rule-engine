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
 * Status rationale (contract 3.1): the Repeat KeywordDef is merged, but its
 * additional-cost declaration and this battlefield's discount still have no
 * card-program consumer in Finalize. The cost.modify/cost.pay and Repeat cost
 * plan work remains pending in RIFT-261, and the RIFT-257 CardProgram binding
 * path does not yet bind this static card ability. The static effect
 * below records the intended scope and delta; nothing is approximated and no
 * cost is silently rewritten in card data.
 */
export default {
  canonicalCardId: "card.hash-e00a3fe8d0f18d062b1743d6d5d1eb534e884d83303af037d7c1d05c3a6a21bd",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "Repeat 关键词展开已合入，但其附加费用和本静态减费没有卡牌侧 Finalize 消费方：" +
    "cost.modify/cost.pay 与 Repeat 的费用计划接线仍待 RIFT-261（356.4/356.4.b/356.4.f），" +
    "且 RIFT-257 的 CardProgram 静态能力绑定尚未把 ContinuousEffect 接入该费用计划；不近似减费。",
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

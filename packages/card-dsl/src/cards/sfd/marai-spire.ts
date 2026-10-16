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
 * Status rationale (contract 3.1): no `cost.modify` primitive or cost-plan
 * consumer exists (RIFT-89 owns cost.*), the Repeat keyword's own expansion
 * documents that its additional-cost payment is not wired into Finalize
 * (keywords/Repeat.ts; cost.additional / cost.pay pending), and the current
 * ContinuousEffect model has no Repeat-cost discount kind. The static effect
 * below records the intended scope and delta; nothing is approximated and no
 * cost is silently rewritten in card data.
 */
export default {
  canonicalCardId: "card.hash-e00a3fe8d0f18d062b1743d6d5d1eb534e884d83303af037d7c1d05c3a6a21bd",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺 cost.modify 原语与 Finalize 费用计划消费方（Repeat 附加费减 1 能量，356.4/356.4.b/356.4.f；RIFT-89 cost.* 未合入），" +
    "且 Repeat 关键词自身文档说明其附加费用尚未接入 Finalize（cost.additional / cost.pay 待办），ContinuousEffect 也无 Repeat 费用减益类型；不近似减费。",
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

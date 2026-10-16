import type { CardProgram } from "../../ir/index.js";

/**
 * Portal Rescue (ogn-102-298) — Spell, 3 energy + 1 power, Mind.
 *
 * Printed text (packages/card-data/data/deck-catalog.json, ogn-102-298):
 *   [Action] (Play on your turn or in showdowns.)
 *   Banish a friendly unit, then play it to base, ignoring its cost.
 *
 * Modeling notes (Core Rules v1.5):
 * - [Action] (806) is declared as a keyword ability only; the Showdown
 *   permission is expanded by effects/keywords/Action.ts (contract 3.7) and
 *   enforced by the chain's own timing check (contract 3.5).
 * - "a friendly unit" is a target: the named Board unit is in a public zone
 *   (355.7 / 355.9.a.1 / 355.10), and it must be controlled by this ability's
 *   controller (355.9.b).
 * - "then play it to base" plays that same card out of Banishment as a Limited
 *   Action (420.3/420.3.a; contract 3.6 GameAction "play" with a location).
 *   The printed "then" is a result reference, so the play is linked to the
 *   banish (359.3.e.14) and reads the banished card's fresh reference from the
 *   banish receipt instead of guessing an identity: a card that changes zones
 *   to or from a Non-Board zone is a new object (124).
 * - "to base" is the destination: the acting side's Base (107.1.c/152.1: a
 *   permanent's Location is the Base or Battlefield it occupies).
 * - "ignoring its cost" sets the card's base Energy cost and base Power cost to
 *   zero (356.1.b/356.1.b.1 — the rule text uses the word "ignore" exactly once
 *   for both costs), which is why this is not a "for [Cost]" rewrite (356.1.a)
 *   and not a single-resource "ignoring its Energy cost" half (356.1.b.2);
 *   356.6 still forbids reducing below 0 and 356.1.b.3 keeps any additional
 *   costs. effect.play requires its cost argument to be an already-finalized
 *   FinalizedCostPlan produced by the cost system; it never derives printed
 *   costs and never implements an ignored-cost rule.
 *
 * Status: judge-required. The banish half is merged and executed by the golden
 * test, but the play half cannot honour "ignoring its cost": no merged
 * producer turns CR 356.1.b.1 into a finalized plan, so passing the descriptor
 * negates rather than paying the printed cost. Both instructions stay linked,
 * and the banished card's reference is read from the receipt.
 */
const portalRescue = {
  canonicalCardId: "card.hash-9595373fe14cedf30b615fbf8b92e3f4477e887d643fbebe7041a8501669ee50",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「play it to base, ignoring its cost」缺已合入的费用改写生产者：CR 356.1.b/356.1.b.1 规定「ignoring its cost」把该牌的基础 " +
    "Energy 与基础 Power 费用置零（不是 356.1.a 的 for [Cost] 替换，也不是 356.1.b.2 的单资源忽略）；" +
    "冻结的 CostSpec 只有 kind/payments/energy/power/discard，没有 ignore/替代费用字段（356.6 还要求不得减到 0 以下），" +
    "且已合入的 effect.play 明确要求 cost 参数是" +
    "费用系统产出、已 Finalize 的 FinalizedCostPlan（它不推导印刷费用、也不实现忽略费用规则），因此按印刷费用打出会错误，" +
    "没有可执行路径。依赖：RIFT-89（cost-plan 的忽略/替代费用入口）。" +
    "banish 半段（effect.banish，428.1）已合入并由 golden 真实执行；两条指令保持 linkedTo（359.3.e.14）。不近似实现。",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      body: [
        {
          id: "portal-rescue.banish-friendly-unit",
          op: "effect.banish",
          args: {
            objects: { kind: "constant", value: { target: "portal-rescue.friendly-unit" } },
            amount: { kind: "constant", value: 1 },
            linkKey: { kind: "constant", value: "banished" }
          },
          targets: [
            {
              id: "portal-rescue.friendly-unit",
              filter: { type: "unit", controller: "self" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          // "then play it to base, ignoring its cost" (420.3/420.3.a,
          // 356.1.b.1). The banished card's fresh reference comes from the
          // banish receipt; the cost argument records the required
          // finalization (both base costs zero, 356.6 floor) that no merged
          // producer materializes yet.
          id: "portal-rescue.play-to-base",
          op: "effect.play",
          linkedTo: "portal-rescue.banish-friendly-unit",
          args: {
            object: {
              kind: "linked-value",
              instructionId: "portal-rescue.banish-friendly-unit",
              key: "banishedObject"
            },
            location: {
              kind: "constant",
              value: { type: "base", player: "controller" }
            },
            cost: {
              kind: "constant",
              value: {
                kind: "cost.modify",
                base: "printed",
                ignore: ["energy", "power"],
                minimum: 0,
                finalized: false
              }
            }
          }
        }
      ]
    }
  ],
  sourceText:
    "[Action] (Play on your turn or in showdowns.)\n" +
    "Banish a friendly unit, then play it to base, ignoring its cost."
} satisfies CardProgram;

export default portalRescue;

import type { CardProgram } from "../../ir/index.js";

/**
 * rad-051-167 Parallel Convergence (Spell, 2 energy + 1 power, Mind).
 *
 * Catalog evidence (packages/card-data/data/deck-catalog.json,
 * dataVersion 2026-10-12-official-gallery, printing rad-051-167):
 * energy 2, power 1, might null, domains ["Mind"], tags [].
 *
 * Printed text (verbatim, sourceText):
 *   "As an additional cost to play this, return a friendly unit to its
 *    owner's hand.
 *    Deal 5 to a unit at a battlefield."
 *
 * Rules reading (CR v1.5):
 * - "As an additional cost to play this, return a friendly unit to its owner's
 *   hand" is a mandatory additional cost paid during Finalize (355.10.c: the
 *   cost clause does not target anything; 356.x cost stages). It is a cost,
 *   not an effect, so it is modelled in the play ability's CostSpec.
 * - "Deal 5 to a unit at a battlefield" is a Deal instruction (418.6.a: the
 *   source is the ability itself) that targets one unit; "at a battlefield" is
 *   only a targeting restriction (355.10.b), not a target on the battlefield.
 *
 * Status: judge-required (2026-10-17 recheck). The damage half below is fully
 * covered by the merged `effect.damage` primitive and is executed by the
 * golden test. The additional cost is not, and it is not approximated:
 * - cost/plan-values.ts readCost still rejects `kind: "additional"`
 *   ("Unsupported cost kind: additional"), so `CostSpec.kind` "additional" has
 *   no posting; and
 * - the frozen cost plan recognizes only the nonstandard payment kinds
 *   `exhaust | discard | recycle | kill | reveal | spend-buff`, so "return a
 *   friendly unit to its owner's hand" has no payment kind either.
 * The 355.1.a / 356.2.b.1 mandatory-additional-cost posting and the
 * return-to-hand payment kind (cost.pay / cost.modify, RIFT-261; the RIFT-89
 * cost pipeline) are the remaining dependencies.
 */
export default {
  canonicalCardId: "card.hash-84ee715c26888cfa3850f44083e64823f41b5db0dc23a4f0511c4eb127d52175",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "2026-10-17 复核：伤害半段「Deal 5 to a unit at a battlefield」用已合入的 effect.damage + 目标过滤表达，" +
    "并有真实执行证据，不再列为缺口。仍缺的是强制附加费用：" +
    "(1) cost/plan-values.ts readCost 不接受 CostSpec.kind \"additional\"（实测 buildCostPlan 抛 " +
    "CostPlanError \"Unsupported cost kind: additional\"），355.1.a/356.2.b.1 的 mandatory-additional 阶段没有投放点；" +
    "(2) 费用计划把非资源费用冻结为 exhaust/discard/recycle/kill/reveal/spend-buff，" +
    "「return a friendly unit to its owner's hand」没有支付种类（cost.pay / cost.modify，RIFT-261；RIFT-89 费用管线）。" +
    "不近似实现（不用 effect.zone 在结算期补做费用动作）。",
  abilities: [
    {
      kind: "play",
      // Printed cost (energy 2, power 1) plus the mandatory additional cost.
      // The payment kind is descriptive: the frozen plan has no
      // return-to-hand cost (see judgeReason).
      cost: {
        kind: "additional",
        energy: { kind: "constant", value: 2 },
        power: { kind: "constant", value: 1 },
        payments: [
          {
            kind: "return-to-hand",
            choice: {
              id: "returned-unit",
              options: ["friendly-unit-you-control"],
              filter: { type: "unit", controller: "you", zone: "board" },
              min: 1,
              max: 1,
              selection: "one"
            }
          }
        ]
      },
      body: [
        {
          id: "parallel-convergence.deal-5",
          op: "effect.damage",
          args: {
            amount: { kind: "constant", value: 5 },
            target: { kind: "constant", value: "unit-at-battlefield" }
          },
          targets: [
            {
              id: "unit-at-battlefield",
              filter: { type: "unit", location: { type: "battlefield" } },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ],
  sourceText:
    "As an additional cost to play this, return a friendly unit to its owner's hand.\n" +
    "Deal 5 to a unit at a battlefield."
} satisfies CardProgram;

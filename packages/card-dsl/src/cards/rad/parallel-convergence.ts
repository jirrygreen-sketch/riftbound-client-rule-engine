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
 * Status: judge-required (2026-10-17 recheck, both halves probed). The damage
 * half below is fully covered by the merged `effect.damage` primitive and is
 * executed by the golden test. The additional cost is not, and it is not
 * approximated:
 * - the program's cost never reaches the plan: programs/play.ts translateCost
 *   rejects the whole spec up front
 *   ("Additional costs are not bound for <id>"), because CostSpec.kind
 *   "additional" is not one of the bound kinds; and
 * - even bypassing that gate, cost/plan-values.ts readCost rejects both
 *   `kind: "additional"` ("Unsupported cost kind: additional") and the
 *   payment kind "return-to-hand" ("Unsupported payment kind"), which is
 *   absent from the NonstandardCostAction set
 *   (`exhaust | discard | recycle | kill | reveal | spend-buff`).
 * - the battlefield restriction uses TargetSpec.location, which the existing
 *   Finalize target plan already understands (355.10.b).
 * The 356.2.a.1 mandatory-additional-cost posting and return-to-hand payment
 * kind remain blocked. The RIFT-685 template row
 * (test/cards/templates/play-effect-damage-685.test.mjs) runs the card's own program
 * through the real chain and shows the whole play rejected at binding time
 * ("Additional costs are not bound for play:<id>"), while the original damage
 * body alone resolves through the real target planner and marks 5. Neither
 * row pays the printed additional cost.
 */
export default {
  canonicalCardId: "card.hash-84ee715c26888cfa3850f44083e64823f41b5db0dc23a4f0511c4eb127d52175",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "2026-10-17 复核：伤害半段已用 effect.damage 真实执行（已有真实执行证据）；仍缺“return a friendly unit to its owner's hand”" +
    "强制附加费用的费用管线：programs/play.ts translateCost 先拒绝该 Spec（实测 Additional costs are not bound for ...），" +
    "cost/plan-values.ts readCost 也不接受 CostSpec.kind \"additional\"（Unsupported cost kind: additional），" +
    "且 payments 没有 return-to-hand 种类，NonstandardCostAction 也不接受 return-to-hand/move-zone，无法在 Finalize 投放 356.2.a.1 的 mandatory-additional。" +
    "战场限制已改用现有 TargetSpec.location，目标翻译不再是缺口；" +
    "模板 play-effect-damage-685 用本卡自身程序经真实链实测：play 在绑定期即被 Additional costs are not bound for play:<id> 拒绝，" +
    "而原始伤害 body 经真实目标翻译/Finalize/解析单独结算 5 点；两者都不代表已支付附加费用。" +
    "不近似实现：不用 effect.zone 在结算期补做费用动作。",
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
              filter: { type: "unit", zone: "board" },
              location: { type: "battlefield" },
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

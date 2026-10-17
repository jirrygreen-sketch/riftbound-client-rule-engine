import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Shimmering Swimmer (rad-014-167) — Unit, Fury, 3 energy / 3 Might.
 *
 * 原文（deck-catalog rad-014-167，逐字）：
 *   "You may kill a friendly unit or gear as an additional cost to play me.\nWhen you play
 *    me, if you paid the additional cost, deal 2 to a unit."
 *
 * Rule basis (CR v1.5):
 * - The optional additional cost (356.2.b) is declared in the play CostSpec as
 *   kind "additional" with a kill payment; the in-cost object choice is not a
 *   target (355.10.c) and uses a PickSpec.
 * - "if you paid the additional cost" (356.2.b.1) now reads the finalized cost
 *   plan/receipt through the merged Condition kind "result"
 *   (selectedAdditional / declinedAdditional); the instruction is not rewritten
 *   as a player choice.
 * - "deal 2 to a unit": one-unit TargetSpec plus effect.damage 2 (418.1.c).
 *
 * Status: judge-required, re-reviewed 2026-10-17. The merged payment
 * predicate: the golden test builds a real optional cost plan, pays it (or
 * declines it), and evaluates this program's condition against the real
 * plan/receipt, so both branches are honestly decided. The remaining gap is the
 * play-side translation bridge: buildCostPlan already supports
 * optionalAdditional and cost/payment.ts supports kill payments, and
 * chain/engine.ts finalize already calls buildCostPlan/payCostPlan, but
 * programs/play.ts translateCost fail-closes on kind:"additional"
 * ("Additional costs are not bound"), so a CardProgram's declared optional cost
 * still cannot enter the play cost plan.
 * Dependency: the additional-cost translation bridge in programs/play.ts
 * (CostSpec kind:"additional" -> CostPlanInput.optionalAdditional).
 */
const abilities: Ability[] = [
  {
    kind: "play",
    cost: {
      kind: "additional",
      payments: [
        {
          kind: "kill",
          choice: {
            id: "shimmering-swimmer.additional-cost",
            options: ["friendly-unit-or-gear"],
            filter: { controller: "controller", type: ["unit", "gear"] },
            min: 1,
            max: 1,
            selection: "one"
          }
        }
      ]
    },
    body: [
      {
        id: "shimmering-swimmer.deal-2",
        op: "effect.damage",
        args: {
          amount: { kind: "constant", value: 2 },
          target: { kind: "constant", value: "shimmering-swimmer.unit" }
        },
        targets: [
          {
            id: "shimmering-swimmer.unit",
            filter: { zone: "board", type: "unit" },
            min: 1,
            max: 1,
            selection: "one"
          }
        ],
        condition: {
          // "if you paid the additional cost"：356.2.b 的费用承诺，由 RIFT-359 的
          // 费用回执谓词读取 finalized plan 的 selectedAdditional/declinedAdditional。
          kind: "result",
          result: "additional-cost-paid",
          id: "shimmering-swimmer.additional-cost"
        }
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-05acd78d132bf8780fd8fba892925f17226694182298a6fdeac69e8a824941e1",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "仍缺打出侧的可选附加费用翻译桥（不近似实现）：buildCostPlan 支持 optionalAdditional、" +
    "cost/payment.ts 支持 kill 付款、chain/engine.ts 的 finalize 已调用 buildCostPlan/payCostPlan，" +
    "但 programs/play.ts 的 translateCost 对 kind:\"additional\" fail-closed（\"Additional costs are not bound\"），" +
    "CardProgram 声明的附加费用仍无法进入打出费用计划。已合入的费用结果谓词（condition.result）让" +
    "“if you paid the additional cost”可执行（condition.result + id 读取 selectedAdditional/declinedAdditional），" +
    "golden 用真实费用计划验证支付/未支付两侧；effect.kill 与 effect.damage 也已由真实解释器执行。" +
    "依赖：programs/play.ts 的附加费用翻译桥。",
  abilities,
  sourceText:
    "You may kill a friendly unit or gear as an additional cost to play me.\n" +
    "When you play me, if you paid the additional cost, deal 2 to a unit."
} satisfies CardProgram;

export default program;

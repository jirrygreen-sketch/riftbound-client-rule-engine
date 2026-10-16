import type { CardProgram } from "../../ir/index.js";

/**
 * Sky Splitter (ogn-014-298) — Spell, 8 Energy + 1 Fury power, Fury.
 *
 * Printed text:
 *   [Action] (Play on your turn or in showdowns.)
 *   This spell's Energy cost is reduced by the highest Might among units you
 *   control.
 *   Deal 5 to a unit at a battlefield.
 *
 * Catalog evidence (packages/card-data/data/deck-catalog.json, dataVersion
 * 2026-10-12-official-gallery): energy 8, power 1 (Fury), might null, tags [].
 *
 * Status: judge-required. The damage half is expressible; the cost clause is not:
 * - "This spell's Energy cost is reduced by ..." is a discount applied while the
 *   spell is being played, not an instruction that resolves on the chain
 *   (356.4.b: "reduced by [amount]"; 356.4.d orders total-cost discounts after
 *   component discounts). The merged cost machinery can apply such a discount,
 *   but only through a caller-supplied `CostPlanInput.discounts`
 *   (engine-core/src/cost/cost-plan.ts `applyDiscount` with resource "energy");
 *   a card can only declare a `CostSpec`, and `readCost` in cost/plan-values.ts
 *   explicitly blocks every CostSpec field outside kind/payments/energy/power/
 *   discard. There is no merged card-level primitive or IR field that registers
 *   a cost discount, so the clause is stated in the shape the cost system would
 *   consume and is left unexecuted.
 * - The discount amount is an aggregate over a filtered set: "the highest Might
 *   among units you control". The frozen IR has `count` plus arithmetic over
 *   explicit operands, but no aggregate expression kind and no way to make the
 *   operands a dynamic query, so the amount below is a descriptive placeholder
 *   for the missing aggregate rather than an executable expression.
 * - 356.4.e (the official Sky Splitter + Eager Apprentice example) fixes the
 *   ordering and minimum semantics: a discount's own minimum binds only that
 *   discount, and other discounts may still take the cost to 0. 206 / 204.1 also
 *   keep the printed cost unmodified for cost checks. Both are consumer-side
 *   obligations of the same missing wiring.
 *
 * Dependencies: a card-declarable cost-discount consumer in the Finalize cost
 * plan (RIFT-89 cost planning) and a maximum-aggregate expression over a
 * filtered set.
 */
const skySplitter = {
  canonicalCardId: "card.hash-94735882304ffe96826dd127aea87fdfaac6f979e3b075524de966b982a9c89f",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「This spell's Energy cost is reduced by the highest Might among units you control」是第 356.4 步的总费用折扣" +
    "（在打出过程中应用，不是链上结算的指令）；但卡牌只能声明 CostSpec，cost/plan-values.ts 的 readCost 明确阻断" +
    "kind/payments/energy/power/discard 之外的字段，唯一能应用折扣的入口是调用方提供的 CostPlanInput.discounts" +
    "（cost/cost-plan.ts applyDiscount，resource: \"energy\"），卡牌层没有可声明的原语或 IR 字段。" +
    "折扣数额还要求对动态集合取最大值（「units you control 中最高的 Might」），冻结 IR 只有 count 与显式操作数算术，" +
    "没有集合聚合表达式，故 amount 仅作描述性占位。356.4.e 的折扣下限与 206/204.1 的印刷费用语义由同一消费方承担。" +
    "依赖：可声明的费用折扣消费方（RIFT-89 费用计划）与集合 max 聚合表达式。",
  sourceText:
    "[Action] (Play on your turn or in showdowns.)\n" +
    "This spell's Energy cost is reduced by the highest Might among units you control.\n" +
    "Deal 5 to a unit at a battlefield.",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      // "This spell's Energy cost is reduced by ...": declared in the shape the
      // cost system consumes. The `aggregate` amount is descriptive only — no
      // merged expression kind can express a max over a filtered set.
      kind: "static",
      effect: {
        kind: "cost.modify",
        resource: "energy",
        component: "total",
        appliesTo: "self",
        amount: {
          kind: "aggregate",
          operator: "max",
          property: "might",
          filter: { type: "unit", zone: "board", controller: "controller" }
        }
      }
    },
    {
      kind: "play",
      // Printed cost (energy 8 + 1 Fury power) comes from the catalog.
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 8 },
        power: { kind: "constant", value: 1 }
      },
      body: [
        {
          id: "sky-splitter.deal-5",
          op: "effect.damage",
          args: {
            amount: { kind: "constant", value: 5 },
            target: { kind: "constant", value: "sky-splitter.unit-at-battlefield" }
          },
          targets: [
            {
              id: "sky-splitter.unit-at-battlefield",
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
  ]
} satisfies CardProgram;

export default skySplitter;

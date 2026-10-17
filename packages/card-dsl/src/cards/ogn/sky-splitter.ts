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
 * Status: judge-required. The damage body executes; two cost dependencies remain:
 * - "This spell's Energy cost is reduced by ..." is a discount applied while the
 *   spell is being played, not an instruction that resolves on the chain
 *   (356.4.b: "reduced by [amount]"; 356.4.d orders total-cost discounts after
 *   component discounts). `cost.modify` and `buildCostPlan` apply supplied
 *   discounts, but `programs/play.ts` only translates the play ability's cost;
 *   it does not collect this static ability into `CostPlanInput.discounts`.
 *   `programs/lifecycle.ts` binds statics on Board entry, and the layer binder
 *   has no cost.modify mapping. This spell needs its own discount during
 *   Finalize while being played from Hand, not an on-Board layer effect.
 * - The discount amount is an aggregate over a filtered set: "the highest Might
 *   among units you control". The frozen IR has `count` plus arithmetic over
 *   explicit operands (including arithmetic.max), but no collection aggregate.
 *   The amount below remains descriptive metadata, not an executable Expr.
 *   The future consumer must read current Might for all controlled units on
 *   Board, including Base, at 356.4.g, without requiring a chosen unit.
 *
 * Already implemented: buildCostPlan orders component/total discounts, applies
 * each discount's own minimum (356.4.e, the Sky Splitter + Eager Apprentice
 * example), floors costs at zero, and preserves printed costs (206 / 204.1).
 * These numeric planner semantics are not the remaining blockers.
 *
 * Dependencies: a Finalize collector for self-discounts active while playing
 * from Hand, and a filtered maximum of current Might evaluated at 356.4.g.
 */
const skySplitter = {
  canonicalCardId: "card.hash-94735882304ffe96826dd127aea87fdfaac6f979e3b075524de966b982a9c89f",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺少第 356.4.a/d/g 步消费本牌 static cost.modify 的 Finalize 接线：" +
    "programs/play 只翻译 play.cost，未收集 static 折扣到 CostPlanInput.discounts；" +
    "lifecycle 只在 Board 入区绑定 static，图层 binder 也没有 cost.modify 映射，无法在从 Hand 打出时应用自身折扣。" +
    "另缺在 356.4.g 对所操控的全部 Board 单位（含基地）当前 Might 取最高值的集合聚合表达式；" +
    "arithmetic.max 只接受显式 operands，不能对动态查询集合取最大值，故 amount 保持描述性占位。",
  sourceText:
    "[Action] (Play on your turn or in showdowns.)\n" +
    "This spell's Energy cost is reduced by the highest Might among units you control.\n" +
    "Deal 5 to a unit at a battlefield.",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      // Descriptive static metadata only: neither the cost collector nor the
      // filtered aggregate Expr exists. Do not move this into the Resolve body.
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

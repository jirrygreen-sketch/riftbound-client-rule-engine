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
 * Status: judge-required (rechecked 2026-10-18). The damage body and numeric
 * cost planner execute; two production cost dependencies remain:
 * - the merged `finalizeCostPlan` collector is not called by the default
 *   CardProgram/Chain Finalize path for a spell's own static discount. The
 *   play translator still supplies only the declared base cost, so the static
 *   self-discount never reaches `CostPlanInput.discounts` while this card is
 *   played from Hand.
 * - the discount amount is an aggregate over a filtered set: "the highest
 *   Might among units you control". The collector evaluates `count` and
 *   arithmetic expressions, but has no collection aggregate that reads the
 *   current Might of every controlled Board unit (including Base) at 356.4.g.
 *   The amount below remains descriptive metadata, not an executable Expr.
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
    "当前两处生产缺口（复核 2026-10-18，356.4.a/d/g）：默认 CardProgram/Chain Finalize 没有调用已合入的 " +
    "finalizeCostPlan/collectCostModifications 来收集本牌 static cost.modify，故从 Hand 打出时自我 Energy 折扣仍不会进入 CostPlanInput.discounts；" +
    "同时费用收集器没有对所操控的全部 Board 单位（含基地）按当前 Might 求最高值的集合聚合表达式，现有 arithmetic.max 只接受显式 operands。" +
    "damage 5、目标地点复核和费用计划的数值顺序已有真实执行证据；不把描述性 aggregate 占位近似成固定数值。",
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

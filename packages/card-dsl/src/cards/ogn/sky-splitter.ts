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
 * Status: judge-required (rechecked 2026-10-18 against the merged engine-core
 * sources). The damage body executes on the production chain path; two cost
 * dependencies are still missing, so the discount is descriptive metadata:
 * - Nothing collects a spell's own static cost declaration while it is played
 *   from Hand (356.4.a applies discounts "by the card being played"):
 *   `chain/engine.ts` Finalize calls `buildCostPlan` directly,
 *   `programs/play.ts` `translateCost` rejects a `discount` field on the play
 *   cost, and `programs/statics.ts` `layerFor` throws judge-required for
 *   `cost.modify` ("Static ability kind cost.modify has no layer mapping").
 *   A played Sky Splitter therefore never puts this declaration into
 *   `CostPlanInput.discounts` and pays the printed 8 Energy even while its
 *   controller has a 7-Might unit.
 * - The discount amount is an aggregate over a filtered set: "the highest
 *   Might among units you control". The IR `Expr` union and `validateExpr`
 *   reject `kind: "aggregate"`, and `cost/discounts/values.ts`
 *   `evaluateCostValue` evaluates only constant/literal/arithmetic/count/
 *   object-property, so `arithmetic.max` cannot read the current Might of
 *   every controlled Board unit (including Base) at 356.4.g. The amount below
 *   stays descriptive metadata until that Expr exists.
 *
 * Total-cost discounts (356.4.d) are declared by omitting `component`;
 * `component: "total"` is not a merged component id and `buildCostPlan`
 * rejects it as an unknown component. The declaration carries an explicit
 * `stage: "discount"` so an unsigned magnitude cannot be read as an increase
 * (signed amounts infer the stage in the merged collector).
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
    "当前两处真实缺口（2026-10-18 第三次复核，逐项对照合并后的 engine-core 源码，CR 356.4.a/356.4.d/356.4.g）：" +
    "(1) 从 Hand 打出本牌时没有消费者收集卡牌自身的静态减费：chain/engine.ts 的 Finalize 直接调用 buildCostPlan，" +
    "programs/play.ts 的 translateCost 只翻译 play.cost 并拒绝 discount 字段，programs/statics.ts 的 layerFor 对 cost.modify 抛 " +
    "\"Static ability kind cost.modify has no layer mapping\"；因此本牌静态 cost.modify 不会进入 CostPlanInput.discounts，" +
    "实测从 Hand 打出仍支付印刷 8 Energy（对手中 7 Might 单位视而不见）。" +
    "(2) 折扣量是集合聚合（356.4.g）：IR 的 Expr 联合与 validateExpr 不接受 kind \"aggregate\"，" +
    "cost/discounts/values.ts 的 evaluateCostValue 只实现 constant/literal/arithmetic/count/object-property，" +
    "arithmetic.max 只接受显式 operands，无法取所操控全部 Board 单位（含基地）当前 Might 的最高值，故 amount 仍是描述性元数据。" +
    "356.4.d 的总费用折扣以省略 component 表达（component: \"total\" 不是合并后的组件 id，会被 buildCostPlan 以 " +
    "\"Discount refers to an unknown cost component\" 拒绝），本牌改用 stage: \"discount\" 且不写 component，避免无符号 aggregate 被误读为加费。" +
    "已实测可执行：damage 5 与 battlefield 目标复核、[Action] 关键词、以及 356.4.e 每条折扣自己的最低值与折扣顺序（buildCostPlan/cost.modify）。",
  sourceText:
    "[Action] (Play on your turn or in showdowns.)\n" +
    "This spell's Energy cost is reduced by the highest Might among units you control.\n" +
    "Deal 5 to a unit at a battlefield.",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      // Descriptive static metadata only: no production Finalize consumer
      // collects this declaration and no filtered aggregate Expr exists. Do
      // not move this into the Resolve body: the reduction is applied while
      // the spell is played (356.4.a/356.4.d), not as a resolving instruction.
      kind: "static",
      effect: {
        kind: "cost.modify",
        resource: "energy",
        // 356.4.d total-cost discount: no component id. "total" is not a
        // merged component id and buildCostPlan rejects it.
        stage: "discount",
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

import type { CardProgram } from "../../ir/index.js";

/**
 * Void Drone (sfd-010-221).
 *
 * Status: judge-required (cards/README.md §2), re-verified 2026-10-18 against the
 * merged engine sources:
 * - The discount shape itself is executable in the merged cost module:
 *   cost/discounts/collect.ts `finalizeCostPlan` consumes this card's own
 *   continuous.cost-modification declaration and gates it on
 *   CostDiscountSources.originZone. Measured: originZone 'hand' pays the full
 *   3 Energy, 'trash'/'banishment' pay 1, and a missing originZone fails closed
 *   with CostPlanError(judge-required) instead of silently applying or skipping
 *   the discount (356.4).
 * - The production play path is still not wired: programs/statics.ts `layerFor`
 *   has no mapping for continuous.cost-modification, so the default CardProgram
 *   lifecycle binding throws ProgramBindingError('judge-required', 'Static
 *   ability kind continuous.cost-modification has no layer mapping'); and
 *   chain/engine.ts Finalize still calls buildCostPlan directly, never
 *   finalizeCostPlan/collectCostModifications, and passes no recorded pre-play
 *   origin zone. A card played from hand must not receive this discount, so the
 *   missing origin plumbing stays a real gap.
 */
export default {
  canonicalCardId: "card.hash-512a6baf401c344f2932b0402985380ea003a2798bef0dec74998bf39db0f00c",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处当前缺口（2026-10-18 复核实测；不近似实现）：(1) 静态声明在生产 lifecycle 无法绑定：programs/statics.ts 的 layerFor 没有 continuous.cost-modification 映射，" +
    "实测 createEngineStaticBinder 绑定本卡 static 抛 ProgramBindingError \"Static ability kind continuous.cost-modification has no layer mapping\"。" +
    "(2) 生产 Finalize 没有该折扣的消费方：chain/engine.ts 的 finalize 仍直接调用 buildCostPlan，" +
    "未调用 cost/discounts/collect.ts 的 finalizeCostPlan/collectCostModifications，也不传 CostDiscountSources.originZone；" +
    "该收集器本身已合入并经本卡 golden 实测（originZone=hand 全价 3、trash/banishment 减为 1、缺 originZone 以 judge-required 失败闭合，356.4），" +
    "所以进入 chain 后的当前区域不能代替打出前来源区域、从手牌打出也不得减费这一门控逻辑正确，缺的只是生产接线。",
  abilities: [
    {
      kind: "static",
      effect: {
        kind: "continuous.cost-modification",
        resource: "energy",
        amount: { kind: "constant", value: -2 },
        appliesTo: "self",
        fromZone: "not-hand"
      }
    }
  ],
  sourceText: "I cost :rb_energy_2: less to play from anywhere other than your hand."
} satisfies CardProgram;

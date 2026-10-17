import type { CardProgram } from "../../ir/index.js";

/**
 * Herald of Scales (ogn-140-298) — Unit, 4 energy, no printed power (Body),
 * 3 Might.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, ogn-140-298):
 *   Your Dragons' Energy costs are reduced by :rb_energy_2:, to a minimum of
 *   :rb_energy_1:.
 *
 * 规则依据（CR v1.5）：
 * - 356.4：折扣在「3. Determine Total Cost」步骤应用；356.4.b 允许“reduced by
 *   [amount]”式写法；356.4.c/356.4.c.1 只作用于某个成本分量；356.4.e 明确“折扣
 *   自带的 minimum 只约束该折扣本身”，不抬高其他折扣或印刷费用。
 * - 366.2 / 366.2.a：被动能力可以改变牌的打出费用，并在该牌可被打出的所有区域
 *   生效（本卡是场上的单位，其“Your Dragons…”静态能力由 layers 的
 *   continuous.cost-modification 承载）。
 * - 133.8 / 133.8.a：“Dragon” 是标签（tag），本身没有内在规则含义，只在被文本
 *   引用时生效；筛选按 `tags: "Dragon"` + 控制者（“Your”）。
 *
 * status: judge-required —— 契约 3.7/费用系统尚未消费静态费用改写：
 * 1. 没有把静态 `continuous.cost-modification` 送进 cost/cost-plan.ts 折扣步骤
 *    （356.4）的 CardProgram 桥接。
 * 2. “Energy costs … reduced by [2], to a minimum of [1]” 的 minimum 语义（356.4.e）
 *    已由 buildCostPlan 实际消费；仍缺把本卡静态来源送入该计划的桥接。
 * 3. 该静态能力作用于“你即将打出的 Dragon 牌”，其 filter 与费用分量（energy）在
 *    此处按契约保持可审查形状，不近似实现。
 */
export default {
  canonicalCardId: "card.hash-8f0ac98c17845f49a654e9543fdfa1946ec646cc7efc52fbd3395790fb4be660",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "仍缺 continuous.cost-modification → 生产 Finalize CostPlanInput.discounts 的来源桥接（CR 356.4）：programs/statics.ts" +
    " 没有该静态类型的 layer 映射，chain/engine.ts 未从场上己方 Herald 收集 Dragon 费用折扣及来源生命周期。CR 356.4.e 要求每个折扣独立保留 " +
    "minimum，不能把最小 1 写成印刷费用或总费用的永久下限。",
  abilities: [
    {
      kind: "static",
      effect: {
        kind: "continuous.cost-modification",
        resource: "energy",
        amount: { kind: "constant", value: -2 },
        minimum: { kind: "constant", value: 1 },
        // CR 133.8: Dragon is a tag; the printed text does not limit card type.
        filter: { tag: "Dragon", controller: "controller" }
      }
    }
  ],
  sourceText:
    "Your Dragons' Energy costs are reduced by :rb_energy_2:, to a minimum of :rb_energy_1:."
} satisfies CardProgram;

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
 * 1. 没有 cost.modify 原语文件，也没有把静态 `continuous.cost-modification`
 *    送进 cost/cost-plan.ts 折扣步骤（356.4）的桥接；RIFT-9 把 cost.modify 列为
 *    必需原语，属费用计划批次（RIFT-89）。
 * 2. “Energy costs … reduced by [2], to a minimum of [1]” 的 minimum 语义（356.4.e）
 *    已由 CostDiscount.minimum 形状描述，但消费方（费用计划生成）未合并。
 * 3. 该静态能力作用于“你即将打出的 Dragon 牌”，其 filter 与费用分量（energy）在
 *    此处按契约保持可审查形状，不近似实现。
 */
export default {
  canonicalCardId: "card.hash-8f0ac98c17845f49a654e9543fdfa1946ec646cc7efc52fbd3395790fb4be660",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「Your Dragons' Energy costs are reduced by [2], to a minimum of [1]」需要费用改写（356.4 折扣步骤）：" +
    "契约 3.7 的 continuous.cost-modification 静态效果没有已合入消费方，cost/cost-plan.ts 的折扣只读 " +
    "CostDiscount 输入，没有把卡牌程序的静态能力送入费用计划的桥接，也没有 cost.modify 原语文件" +
    "（RIFT-9 列为必需原语，属费用计划批次 RIFT-89）。356.4.e 的「minimum 只约束该折扣」已由 CostDiscount.minimum " +
    "形状预留但未消费；不近似实现，也不把最小 1 写成对印刷费用的改写。",
  abilities: [
    {
      kind: "static",
      effect: {
        kind: "continuous.cost-modification",
        resource: "energy",
        amount: { kind: "constant", value: -2 },
        minimum: { kind: "constant", value: 1 },
        filter: { type: "unit", tag: "Dragon", controller: "controller" }
      }
    }
  ],
  sourceText:
    "Your Dragons' Energy costs are reduced by :rb_energy_2:, to a minimum of :rb_energy_1:."
} satisfies CardProgram;

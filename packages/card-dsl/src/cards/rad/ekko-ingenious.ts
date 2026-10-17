import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * rad-061-167 Ekko, Ingenious（能量 3、Power 无印刷值、Might 4、领域 Mind、
 * 标签 Ekko/Zaun/Champion；alternate printing rad-061a-167 同 canonical）。
 *
 * 原文（逐字）：
 *   As an additional cost to play me, return a friendly unit to its owner's hand.
 *   [Ganking] (I can move from battlefield to battlefield.)
 *
 * 规则依据（CR v1.5）：
 * - "As an additional cost to play me" 是打出该单位时的**必选附加费用**：附加费用在
 *   Determine Total Cost / Pay Costs 阶段按 356.2/404.2 计入（355.10.c.1 明确
 *   "[do X] to [do Y]" 这类指令内费用不因此成为目标）。"return a friendly unit to
 *   its owner's hand" 是非目标选择（355.10.c：费用中的选择不是目标），因此写成
 *   CostSpec.payments 内的 PickSpec，而不是 TargetSpec。
 * - [Ganking]（810.1）：Passive Ability 关键词，810.1.b 等价于 "I may move to a
 *   battlefield from another battlefield with a standard move"；810.2 多个实例冗余
 *   （stacking single）；810.3 是可引用特征。按 README 第 5 节只声明关键词，展开
 *   （continuous.movement 许可）属 effects/keywords/Ganking.ts。
 *
 * 状态：judge-required。两处缺口，均有依据但不可执行：
 * 1. 附加费用"return a friendly unit to its owner's hand"：费用管线
 *    （cost/plan-values.ts）接受的付款种类只有 energy/xp/power 与
 *    exhaust/discard/recycle/kill/reveal/spend-buff；`return-to-hand` 不在其中
 *    （实测 buildCostPlan 抛 CostPlanError: judge-required，"Unsupported payment
 *    kind: return-to-hand"），没有已合入原语能把"把友方单位移回手牌"作为费用收取。
 * 2. [Ganking] 展开产出 continuous.movement 静态许可，但移动系统
 *    （zones/movement.ts）尚无读取该许可的接口（keywords/Ganking.ts 自身注释已标注
 *    该依赖），因此关键词展开不可执行。
 * 依赖：费用管线批次（RIFT-89 batch3-cost-plan）与移动许可消费方（无已分配任务号）。
 * 不近似实现：不把附加费用改写成 effect.zone 的结算指令（那会变成"结算时移动"而非
 * "打出费用"），也不因为能写出关键词声明就标记 executable。
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "ganking" },
  {
    kind: "play",
    cost: {
      kind: "additional-cost",
      optional: false,
      payments: [
        {
          kind: "return-to-hand",
          choice: {
            id: "ekko-ingenious.returned-unit",
            // 费用中的选择不是目标（355.10.c）：非目标 PickSpec。
            options: ["friendly-unit-on-board"],
            min: 1,
            max: 1,
            selection: "one",
            filter: { type: "unit", controller: "controller", zone: "board" }
          }
        }
      ]
    },
    // 除附加费用与 Ganking 外没有其他效果正文。
    body: []
  }
];

const program = {
  canonicalCardId:
    "card.hash-4e3817bb5cbd6b0566c6696ba86ac4b5b31ef599a37c2c9b8a3254e0c9e4665b",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "附加费用「return a friendly unit to its owner's hand」没有收费路径：cost 管线（cost/plan-values.ts）接受的付款种类为 energy/xp/power 与 " +
    "exhaust/discard/recycle/kill/reveal/spend-buff，`return-to-hand` 不在其中（buildCostPlan 实测抛 CostPlanError: judge-required，" +
    "\"Unsupported payment kind: return-to-hand\"），没有已合入原语能以费用形式把友方单位移回手牌（356.2 / 404.2 的附加费用阶段）；" +
    "[Ganking]（810.1）的关键词展开产出 continuous.movement 许可，但 zones/movement.ts 尚无读取该许可的接口，关键词展开同样不可执行。" +
    "依赖：RIFT-89（batch3-cost-plan）与移动许可消费方。不近似实现：不把附加费用改写成结算期 effect.zone，也不因能声明关键词就标记 executable。",
  abilities,
  sourceText:
    "As an additional cost to play me, return a friendly unit to its owner's hand.\n" +
    "[Ganking] (I can move from battlefield to battlefield.)"
} satisfies CardProgram;

export default program;

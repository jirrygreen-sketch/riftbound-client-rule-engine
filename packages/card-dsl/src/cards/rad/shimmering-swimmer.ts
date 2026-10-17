import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Shimmering Swimmer (rad-014-167) — Unit, Fury, 3 energy / 3 Might.
 *
 * 原文（deck-catalog rad-014-167，逐字）：
 *   "You may kill a friendly unit or gear as an additional cost to play me.\nWhen you play
 *    me, if you paid the additional cost, deal 2 to a unit."
 *
 * 规则依据（CR v1.5）：
 * - "You may kill a friendly unit or gear as an additional cost to play me"：可选附加费用
 *   （356.2.b，"may" + "as an additional cost"）；费用内的对象选择不是目标
 *   （355.10.c），故用非目标 PickSpec 建模为 kill 费用付款。
 *   play 能力的 CostSpec 表达附加费用（kind: "additional"，payments 内 kill 付款），
 *   由 Finalize 的费用管线校验/收费（cost/payment.ts 支持 kill 付款）；
 * - "When you play me, if you paid the additional cost"：Play Effect（383.4.a）+ 支付条件
 *   （356.2.b.1 的费用承诺；Contract 3.9 用条件包住指令而不是改写成 choice）；
 * - "deal 2 to a unit"：TargetSpec 单个单位、effect.damage 固定 2（418.1.c）。

 * status: judge-required（不近似实现），按合入后的费用计划与 src/programs/play.ts 复核：
 * - 可选附加费用的收取路径缺打出侧翻译桥：buildCostPlan 支持 optionalAdditional
 *   （cost/cost-plan.ts）、cost.kinds 有 additional 包装且 chain/engine.ts 的 finalize
 *   已调用 buildCostPlan/payCostPlan，但 programs/play.ts 的 translateCost 对
 *   kind:"additional" fail-closed（"Additional costs are not bound"），CardProgram 的
 *   附加费用仍无法进入打出费用计划；
 * - “if you paid the additional cost” 的结果条件在调研里记为 condition.result（模板表 46 行），
 *   但合并 Condition 只有 always/never/compare/all/any/not/expression，既没有 paid/费用结果
 *   谓词，也没有把费用收据写进链接值的原语；程序用一个 fail-closed 的占位 subject 记录该
 *   判别式，绝不把「未支付」默认成支付。
 *
 * 已合入部分的执行证据：effect.kill（kill 费用）与 effect.damage 在 golden 测试里用真实
 * 解释器执行；条件与费用计划写成 test.todo。
 * 依赖：programs/play.ts 的附加费用翻译桥（把 CostSpec 的 kind:"additional" 翻译成
 * CostPlanInput.optionalAdditional）。
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
          kind: "compare",
          // "if you paid the additional cost"：356.2.b 的费用承诺。当前 Condition 无
          // paid/费用结果谓词，只能用审查用占位 subject；过滤器带不存在的 zone，
          // 使条件在凭证管线落地前 fail-closed（默认“未支付 → 不结算伤害”）。
          left: {
            kind: "count",
            subject: "additional-cost-paid",
            filter: { zone: "cost-receipt" }
          },
          operator: "gte",
          right: { kind: "constant", value: 1 }
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
    "两个缺口，均不近似实现：(1) 可选附加费用的打出翻译桥缺失——buildCostPlan 支持 optionalAdditional、" +
    "cost/payment.ts 支持 kill 付款、chain/engine.ts finalize 已调用 buildCostPlan/payCostPlan，" +
    "但 programs/play.ts 的 translateCost 对 kind:\"additional\" fail-closed（\"Additional costs are not bound\"）。" +
    "(2) “if you paid the additional cost” 无可用条件谓词：合并 Condition 只有" +
    "always/never/compare/all/any/not/expression，没有 paid/费用结果谓词，也没有把费用收据写进链接值的原语，" +
    "程序用一个 fail-closed 的占位 subject（不存在的 zone）记录该判别式，绝不把未支付默认成支付。" +
    "已在 play.cost 声明 kill 附加费用、用非目标 pick（355.10.c）与 effect.damage（418.1.c）写出可审查形状；" +
    "effect.kill 与 effect.damage 两段由 golden 真实执行。不近似实现。",
  abilities,
  sourceText:
    "You may kill a friendly unit or gear as an additional cost to play me.\n" +
    "When you play me, if you paid the additional cost, deal 2 to a unit."
} satisfies CardProgram;

export default program;

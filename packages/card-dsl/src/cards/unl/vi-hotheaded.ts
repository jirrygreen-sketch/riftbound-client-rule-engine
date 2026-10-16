import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Vi, Hotheaded (unl-030-219) — Unit, 4 energy, no printed power, Might 3,
 * Fury, tags Vi/Zaun/Champion.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-030-219，逐字）：
 *   [Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell
 *   or ability.)
 *   :rb_energy_2::rb_rune_fury:: Double my Might this turn.
 *
 * 规则依据（CR v1.5）：
 * - [Deflect]（809.1.b.3）：省略数值时 Deflect Value 为 1（本卡印刷 [Deflect] 无数字）；
 *   809.1.c / 809.1.c.1 让对手用法术/能力选择我时额外支付相应数量的 [A]。只声明 keyword（契约 3.7），
 *   展开（target.tax 静态效果）由 effects/keywords/Deflect.ts 负责。
 * - 377.1 / 404.1.a / 415.5：“:” 之前是费用——2 Energy 加 1 点 Fury Power；
 *   合并费用管线（cost/plan-values.ts、cost/payment.ts）真实支持该组合。
 * - 381 / 381.1：印刷没有 [Action] 或 [Reaction]，启动能力在控制者回合的 Open State 以默认 Action
 *   速度启动，因此 timing = "action"。
 * - 433.1 / 433.1.a：Doubling 是把数值属性按该属性当前值增加同量，并按该效果指定的期限生效；
 *   433.1.a 的示例正是 “Double a friendly unit's Might this turn.”。所以数额写成结算时读取来源
 *   当前 Might 的 object-property 表达式，期限 this turn（143.2.a 的 Might 指有效 Might；
 *   475/478 的算术层与期限）。“my Might” 是自我指称（355.10.g），不是目标，因此不写 TargetSpec，
 *   也不使用 target 参数。
 *
 * status = judge-required（缺口不近似实现）：
 * - “Double my Might this turn” 是 arithmetic 层的本回合 Might 修正，但 effects/instructions/ 与关键词
 *   注册表都没有注册 continuous.might（或等价临时 Might 修改）原语，契约 3.6 的封闭 GameAction 集合也没有
 *   Might 修改动作（RIFT-91 只合入 layers 求值侧）；effect.buff 的文件头明确 Buff 计数器（702/703）
 *   不是 Might 修正，不得代替。
 * - [Deflect] 的 target.tax 没有消费方：契约 3.8 第 4 条把“成为目标/目标锁定通知”归引擎批 4，
 *   TargetPlan 只接受调用方经 TargetFinalizeOptions.tax 传入的税，链的 Finalize 没有从图层读取 target.tax
 *   的接线（RIFT-90），cost.pay 也未并入目标税（RIFT-89）。
 * 已合入并可真实执行的部分：2 Energy + 1 Fury Power 的印刷费用（golden 走 buildCostPlan/payCostPlan 真实支付）。
 */
const abilities: Ability[] = [
  // 809.1.b.3：印刷的 [Deflect] 省略数值，Deflect Value 按 1 处理（省略 value）。
  { kind: "keyword", keyword: "deflect" },
  {
    kind: "activated",
    timing: "action",
    cost: {
      kind: "activated",
      energy: { kind: "constant", value: 2 },
      power: { kind: "constant", value: ["Fury"] }
    },
    body: [
      {
        id: "vi-hotheaded.double-might",
        // 433.1 / 433.1.a：Doubling 增加“该属性当前值”的量，期限由该效果指定（this turn）。
        // 本回合到期的临时 Might 修正属 layers 的 continuous.might（见 judgeReason）。
        op: "continuous.might",
        args: {
          mode: { kind: "constant", value: "add" },
          layer: { kind: "constant", value: "arithmetic" },
          amount: {
            kind: "object-property",
            object: "self",
            property: "might"
          },
          duration: { kind: "constant", value: "this-turn" }
        }
      }
    ]
  }
];

const program = {
  canonicalCardId:
    "card.hash-8cb7905705a7f0e4995a084c0d8fa96d23d5387f51a0294a9e8cdc4250cb4b83",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "「Double my Might this turn.」（433.1/433.1.a 的 Doubling：按结算时该属性的当前值增加同量，期限由本效果指定）" +
    "需要 arithmetic 层的本回合临时 Might 修正，但没有可执行路径：契约 3.6 的封闭 GameAction 集合没有 Might 修改动作，" +
    "effects/instructions/ 与关键词注册表都没有注册 continuous.might（或等价临时 Might 修改）原语，也没有任何指令通过 " +
    "ResolveContext.addContinuous 注册该持续效果（RIFT-91 只合入 layers 求值侧）；effect.buff 的文件头明确 " +
    "Buff 计数器（702/703）不是 Might 修正，不得代替。" +
    "[Deflect]（809.1.b.3 省略数值时按 1；809.1.c）的 target.tax 同样没有消费方：契约 3.8 第 4 条把“成为目标/目标锁定通知”归引擎批 4，" +
    "TargetPlan 只接受调用方经 TargetFinalizeOptions.tax 传入的税，链的 Finalize 没有从图层读取 target.tax 的接线" +
    "（RIFT-90），cost.pay 也未并入目标税（RIFT-89）。" +
    "已可真实执行的部分：2 Energy + 1 Fury Power 的印刷费用（buildCostPlan/payCostPlan）。依赖：RIFT-91、RIFT-90、RIFT-89。不近似实现。",
  abilities,
  sourceText:
    "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)\n" +
    ":rb_energy_2::rb_rune_fury:: Double my Might this turn."
} satisfies CardProgram;

export default program;

import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Xerath, Freed (unl-026-219) — Unit, 5 energy, no printed power, Might 5,
 * Fury, tags Shurima/Xerath/Champion.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-026-219，逐字）：
 *   :rb_rune_fury:, :rb_exhaust:: Deal 3 to a unit. Use this ability only while
 *   I'm at a battlefield.
 *
 * 规则依据（CR v1.5）：
 * - 377.1 / 404.1.a / 415.5：“:” 之前是费用——1 点 Fury Power 加上横置来源；
 *   合并费用管线（cost/plan-values.ts、cost/payment.ts）能收取 energy / power / exhaust 支付。
 * - 381 / 381.1：印刷没有 [Action] 或 [Reaction]，启动能力在控制者回合的 Open State 以默认
 *   Action 速度启动，因此 timing = "action"（对照已合入 ogn/energy-conduit 的 reaction 声明）。
 * - 377.2.b / 377.2.b 的示例（Ultrasoft Poro “Use this ability only while I'm at a battlefield.”）：
 *   “Use this ability only while …” 是**启动该能力的前置限制**，必须在启动时就为真；
 *   该条示例与本卡原文一致。
 * - “Deal 3 to a unit”：单个单位（不限定控制者）是选目标（355.9 / 355.10），
 *   用已合入的 effect.damage（amount 3、target 指向 TargetSpec）提交伤害动作（418）。
 *
 * status = judge-required：
 * - “Use this ability only while I'm at a battlefield.” 没有消费方：契约 3.1 的 ActivatedAbility.restriction
 *   是数据声明，链的 Finalize 只检查调用方传入的 Condition（chain/engine.ts），没有任何模块把卡牌的
 *   Restriction 编译成启动前校验，因此无法保证“在基地时不能启动”。用 TargetSpec / filter 冒充启动限制
 *   会把它错误地变成目标限制，属于近似实现，不做。
 * 已合入并可真实执行的部分：1 Fury Power + 横置自身的费用（golden 走 buildCostPlan/payCostPlan 真实支付）、
 * effect.damage 的伤害本体与目标失效分支（golden 用解释器 + 参考内核执行）。
 * 依赖：RIFT-89（费用/启动接线）、RIFT-91（限制消费）。
 */
const abilities: Ability[] = [
  {
    kind: "activated",
    timing: "action",
    cost: {
      kind: "activated",
      power: { kind: "constant", value: ["Fury"] },
      payments: [{ kind: "exhaust", object: "self" }]
    },
    // 377.2.b：“Use this ability only while I'm at a battlefield.” —— 启动前置限制。
    // 保留为限制声明；合并内核没有把卡牌 Restriction 编译进启动校验的消费方（见 judgeReason）。
    restriction: { kind: "use-only-while-source-at-battlefield" },
    body: [
      {
        id: "xerath-freed.deal-3",
        op: "effect.damage",
        args: {
          amount: { kind: "constant", value: 3 },
          target: { kind: "constant", value: "xerath-freed.unit" }
        },
        targets: [
          {
            id: "xerath-freed.unit",
            // 355.9 / 355.10：“a unit” 是单个由玩家选择的单位目标（不限控制者）。
            filter: { type: "unit", zone: "board" },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      }
    ]
  }
];

const program = {
  canonicalCardId:
    "card.hash-df5f8cc7c386af601102e9b0239a7e699523e75147d4cf3cfa84225e77cdc759",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "「Use this ability only while I'm at a battlefield.」（377.2.b 的启动前置限制，官方示例即同一句式）没有消费方：" +
    "契约 3.1 的 ActivatedAbility.restriction 只是数据声明，chain/engine.ts 的 Finalize 只检查调用方传入的 Condition，" +
    "没有任何模块把卡牌的 Restriction 编译成“启动前必须满足”的校验（RIFT-91 / RIFT-89 的记录同）——" +
    "因此无法保证在基地时不能启动；把它写进 TargetSpec/filter 会错误地变成目标限制，属近似实现，不做。" +
    "已合入并可真实执行的部分：1 Fury Power + 横置自身的印刷费用（buildCostPlan/payCostPlan 真实支付）与 " +
    "effect.damage 的伤害本体（golden 覆盖目标失效的 negated/ignored 分支）。依赖：RIFT-89（费用/启动接线）、RIFT-91（限制消费）。",
  abilities,
  sourceText:
    ":rb_rune_fury:, :rb_exhaust:: Deal 3 to a unit. Use this ability only while I'm at a battlefield."
} satisfies CardProgram;

export default program;

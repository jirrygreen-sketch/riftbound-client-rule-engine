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
 * status = judge-required（2026-10-16 复核）：
 * - RIFT-257 的 programs/activate.ts 现在已经调用 translateRestriction，把卡牌 Restriction 编译进
 *   ChainDraft.restrictions（chain/engine.ts 的 Finalize 会求值），所以“没有消费者”的旧描述已过时。
 *   但当前缺口仍在：(1) 描述性 kind 没有适配器——translateLegalityCondition 只接受直接给出 Condition
 *   的规则对象或 always/never/compare/all/any/not/expression 这些 kind，本卡的 kind 会让 describeActivate
 *   抛 ProgramBindingError(judge-required)（探针确认），fail-closed 而不是近似放行；(2) 即使写成 Condition，
 *   “I'm at a battlefield” 也没有可诚实表达的位置类型谓词：object-property(source, "location") 返回的是
 *   LocationRef 对象本身（不是类型），契约 3.6 的 Expr 没有嵌套 location.type 的读法，而 layers/engine.ts
 *   的 conditionMatches 对未知条件一律返回 true——直接绑定会在 Base 也允许启动。用 TargetSpec/filter 冒充
 *   启动限制会把它错误地变成目标限制，属近似实现，不做。
 * 已合入并可真实执行的部分：1 Fury Power + 横置自身的费用（golden 走 buildCostPlan/payCostPlan 真实支付）、
 * effect.damage 的伤害本体与目标失效分支（golden 用解释器 + 参考内核执行）。
 * 依赖：RIFT-257 后续（Restriction → Condition 适配器与位置类型谓词）、RIFT-90（启动前校验语义）。
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
    "「Use this ability only while I'm at a battlefield.」（377.2.b 的启动前置限制，官方示例即同一句式）仍未可执行，" +
    "但缺口已从“没有消费者”变为“没有适配器与谓词”：RIFT-257 的 programs/activate.ts 已经调用 translateRestriction，" +
    "把 Restriction 编译进 ChainDraft.restrictions 并由 chain/engine.ts 的 Finalize 求值，" +
    "而 translateLegalityCondition 只接受直接给出 Condition 的规则对象或 always/never/compare/all/any/not/expression，" +
    "本卡的描述性 kind 会让 describeActivate 抛 ProgramBindingError(judge-required)（探针确认，fail-closed）。" +
    "即使改写成 Condition，“I'm at a battlefield” 也没有可诚实表达的位置类型谓词：" +
    "object-property(source, \"location\") 返回 LocationRef 对象本身（不是类型），契约 3.6 的 Expr 没有嵌套 location.type 的读法，" +
    "layers/engine.ts 的 conditionMatches 对未知条件一律返回 true——直接绑定会在 Base 也允许启动（近似实现）。" +
    "用 TargetSpec/filter 冒充启动限制会把它错误地变成目标限制，不做。" +
    "已合入并可真实执行的部分：1 Fury Power + 横置自身的印刷费用（buildCostPlan/payCostPlan 真实支付）与 " +
    "effect.damage 的伤害本体（golden 覆盖目标失效的 ignored 分支）。依赖：RIFT-257 后续（Restriction → Condition 适配器与位置类型谓词）、RIFT-90。",
  abilities,
  sourceText:
    ":rb_rune_fury:, :rb_exhaust:: Deal 3 to a unit. Use this ability only while I'm at a battlefield."
} satisfies CardProgram;

export default program;

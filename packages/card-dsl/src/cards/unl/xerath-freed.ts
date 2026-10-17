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
 * status = judge-required（2026-10-17 复核）：仅剩 377.2.b 的战场启动限制。
 * programs/activate.ts 已消费 Restriction，并交给 Chain Finalize 校验；费用与 effect.damage
 * 均已合入。当前还需把来源的 LocationRef.type 判定编译成可执行 Condition（RIFT-359）：
 * object-property(source, "location") 只能读取整个 LocationRef，不能读取嵌套 type；
 * describeActivate 对本卡描述性 restriction kind 仍会 fail-closed。
 * golden 直接执行原始 body（保留 TargetSpec），另经 buildCostPlan/payCostPlan 支付印刷费用。
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
    // 位置类型 Condition 的适配尚待 RIFT-359；不能把启动限制改成目标限制。
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
    "377.2.b 的「Use this ability only while I'm at a battlefield.」仍需来源位置类型谓词（RIFT-359）：" +
    "programs/activate.ts 已把 Restriction 交给 Chain Finalize，但本卡的描述性 kind 尚不能编译成 Condition；" +
    "object-property(source, location) 只返回完整 LocationRef，现有 Expr 无嵌套 type 读取，" +
    "必须在启动时区分 Base 与任意 Battlefield，不能用目标过滤替代。",
  abilities,
  sourceText:
    ":rb_rune_fury:, :rb_exhaust:: Deal 3 to a unit. Use this ability only while I'm at a battlefield."
} satisfies CardProgram;

export default program;

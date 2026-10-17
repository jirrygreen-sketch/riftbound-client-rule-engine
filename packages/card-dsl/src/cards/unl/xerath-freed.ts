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
 * - 377.2.b（其示例同样由 Ultrasoft Poro 给出 “Use this ability only while I'm at a
 *   battlefield.”）：“Use this ability only while …” 是**启动该能力的前置限制**，必须在启动时
 *   就为真。
 * - “Deal 3 to a unit”：单个单位（不限定控制者）是选目标（355.9 / 355.10），
 *   用已合入的 effect.damage（amount 3、target 指向 TargetSpec）提交伤害动作（418）。
 *
 * status = judge-required（2026-10-17 复核；缺口不近似实现）：仅剩 377.2.b 的战场启动限制。
 * programs/activate.ts → translateRestriction 已能把 Restriction.condition 原样送入 ChainDraft，
 * Chain Finalize 用 context.test(condition) 在支付前校验（实测：带 condition 的 restriction
 * 正常翻译，不带 condition 的描述性 kind 抛 needs a rules adapter）。缺的是**可判定的
 * 来源位置谓词**：engine 的 Condition 词表没有任何能读来源 LocationRef.type 的形状——
 * （a）object-property(source, "location") 只返回整个 LocationRef（实测得到 {type,id}/{type,player}），
 * compare 对 "battlefield" 字符串恒为 false；
 * （b）count({ object: "self", location: "battlefield" }) 的唯一求值路径是集合查询：
 * layers/filter.ts 确实能按 type 字符串匹配 location（实测 battlefield 单位为 true、Base 单位 false），
 * 但 Condition 求值走的是 ResolveContext.test → 参考内核的 query/test，完全不消费 object 锚点
 * （实测两种位置下 test 均返回 false、query 均为 []），而且该形状只过滤集合成员，
 * 无法把来源自身的位置类型当作启动许可。
 * 因此现有形状既不能区分 Base 与任意 Battlefield，也不能作为启动许可。
 * 不做替代：把限制改成目标过滤、或把 body 包成 condition 都属于发明语义。
 * 已合入并有真实执行证据：1 点 Fury Power + 横置的印刷费用（buildCostPlan/payCostPlan，
 * 含非 Fury 池付费失败与二次启动被拒），以及 effect.damage 对锁定单位造成印刷的 3 点。
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
    // 位置类型谓词没有可判定形状（见 judgeReason）；不能把启动限制改成目标限制。
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
    "377.2.b 的「Use this ability only while I'm at a battlefield.」仍需来源位置类型谓词：" +
    "Restriction 的 condition 已被 programs/activate.ts → translateRestriction 送入 ChainDraft 并在 Finalize 求值" +
    "（无 condition 的描述性 kind 会抛 needs a rules adapter），但 Condition/Expr 词表没有读取来源位置类型（LocationRef.type）的形状：" +
    "object-property(source, location) 只返回整个 LocationRef，compare 对 \"battlefield\" 恒为 false；" +
    "count({ object: \"self\", location: \"battlefield\" }) 只走集合查询：layers/filter.ts 能按 type 字符串匹配 location，" +
    "但 Condition 求值的 ResolveContext.test 走参考内核的 query/test，完全不消费 object 锚点（实测两种位置下均为 false/[]），" +
    "且该形状只过滤集合成员、无法把来源自身的位置类型当作启动许可。" +
    "必须在启动时区分 Base 与任意 Battlefield，不能用目标过滤或 body 条件替代；印刷费用（1 Fury Power + 横置）与 effect.damage 3 已有真实执行证据。",
  abilities,
  sourceText:
    ":rb_rune_fury:, :rb_exhaust:: Deal 3 to a unit. Use this ability only while I'm at a battlefield."
} satisfies CardProgram;

export default program;

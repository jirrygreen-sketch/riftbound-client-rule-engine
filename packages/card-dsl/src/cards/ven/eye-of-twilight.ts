import type { CardProgram } from "../../ir/index.js";

/**
 * Eye of Twilight (ven-147-166) — Legend, Calm/Order, tag Shen.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-147-166，逐字）：
 *   [Action][>] :rb_exhaust:: Give a friendly unit [Tank] this turn. (It must be
 *   assigned combat damage first.)
 *
 * 规则依据（Core Rules v1.5）：
 * - 806.1.d / 135.2.e.7.b：[Action][>] 是修饰其后启动能力的许可关键词；契约 3.1 用
 *   activated.timing = "action" 记录（与 RIFT-238 的 Defender of Tomorrow 同写法）。
 * - 204.1.b / 415.5：「:」前的 :rb_exhaust: 是启动能力的 Base Cost（Exhaust 此来源）；
 *   合并费用管线支持 payments: [{ kind: "exhaust", object: "self" }]（RIFT-89）。
 * - 355.9 / 355.10：「a friendly unit」的单个对象是被选目标，结算时若失效则 ignored
 *   （359.3.e.7）。
 * - 815 / 815.1 / 815.1.b / 815.3：[Tank] 是被动能力关键词，功能等价于「战斗伤害步骤中，
 *   必须先给我分配致命伤害，之后才能给同一控制者的其它无 [Tank] 单位分配伤害」；它是单位
 *   的可引用特征。本卡的授予带 “this turn” 期限（回合结束到期）。
 *
 * 复核（2026-10-17，第二轮 M2 覆盖率复核）：原 judgeReason 的两条依赖已合入——
 * Tank 的 KeywordDef（RIFT-264，effects/keywords/Tank.ts）与 continuous.grant-keyword
 * 指令原语（RIFT-258）都在当前内核里：授予按 478.1.a 建立 ability 层注册，"this turn"
 * 按 317.1.a / 468.7.c 走 end-of-turn 到期。本卡程序因此改用合并 IR 的选择器形状
 * （`objects: { kind: "target", id }`，契约 3.6 / 与 smoke-screen、siphon-power 的
 * 选择约定一致）而不是把 TargetSpec id 塞进 Expr；golden 用生产链适配器
 * （chain/interpreter-adapter）执行真实 body，并用图层引擎断言真实授予与到期、
 * 以及目标离场时的 ignored/mistargeted 边界。
 *
 * status = judge-required（复核 2026-10-17，唯一剩余缺口）：
 * 815.1.b / 815.1.c.2 的战斗伤害分配语义没有消费方。[Tank] 展开出的
 * `continuous.combat`（Tank.ts 的 TANK_EFFECT）在 layers/engine.ts 里没有分支——
 * applyAbility 与 applyArithmetic 都不命中该 kind；effects/instructions/continuous.combat.ts
 * 因为没有消费方而在指令 execute 末尾直接返回 negated/impossible（实测调用该原语得到
 * {status:"negated",reason:"impossible"}）；combat/ 的窄路径明确只证明
 * 「无 assignment modifier / 无 [Tank] 指派优先级」（base-combat-allocation.ts 的
 * DuelBaseCombatSourceEffectProof.keywordPriority: "proven-none"）。因此本卡即使授予成功，
 * 也不会改变 Combat Damage step 的指派顺序，不能宣称整卡可执行。
 * 依赖：战斗伤害分配工作流消费 continuous.combat。
 * 费用与 effect.exhaust 本体已合入，golden 用真实费用计划 + 真实解释器执行。
 */
const eyeOfTwilight = {
  canonicalCardId: "card.hash-58b622a816049405488a25adae394668eeed8847e5a9ff884d3f09ce03886a4d",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺少战斗伤害分配对 Tank 展开的 continuous.combat 的消费：被授予的 Tank 尚不能按 " +
    "815.1.b / 815.1.c.2 改变致命伤害分配顺序（continuous.combat 指令在没有 combat consumer 时" +
    "直接返回 negated/impossible，实测同结果）；combat/base-combat-allocation.ts " +
    "的 DuelBaseCombatSourceEffectProof 仍要求 keywordPriority 为 proven-none。不近似实现该指派优先级。",
  abilities: [
    {
      kind: "activated",
      // [Action][>]：能力级许可关键词（806.1.d），按契约 3.1 记在 activated.timing。
      timing: "action",
      cost: {
        kind: "activated",
        // :rb_exhaust: = Exhaust 此来源（204.1.b、415.5）。本卡没有印刷 Energy / Power 费用。
        payments: [{ kind: "exhaust", object: "self" }]
      },
      body: [
        {
          id: "eye-of-twilight.grant-tank",
          // 「Give a friendly unit [Tank] this turn」：带 end-of-turn 期限的关键词授予。
          // 授予原语已合入；Tank 的战斗分配消费仍是 judgeReason 所列缺口。
          op: "continuous.grant-keyword",
          args: {
            keyword: { kind: "constant", value: "Tank" },
            duration: { kind: "constant", value: "this-turn" },
            // 契约 3.6 的符号目标选择器：continuous.grant-keyword 由解释器把选择器
            // 解析成运行时 ObjectRef（与其他 continuous.* 原语的 objects 约定一致）。
            objects: {
              kind: "constant",
              value: { kind: "target", id: "eye-of-twilight.unit" }
            }
          },
          targets: [
            {
              id: "eye-of-twilight.unit",
              // “a friendly unit”：单个由你控制的单位（355.9/355.10；359.3.e.7）。
              filter: { type: "unit", zone: "board", controller: "self" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ],
  sourceText:
    "[Action][>] :rb_exhaust:: Give a friendly unit [Tank] this turn. " +
    "(It must be assigned combat damage first.)"
} satisfies CardProgram;

export default eyeOfTwilight;

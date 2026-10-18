import type { CardProgram } from "../../ir/index.js";

/**
 * Piltover Enforcer (unl-187-219) — Legend, Fury/Order, tag Vi.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-187-219，逐字）：
 *   When you conquer, if you assigned 3 or more excess damage, you may
 *   exhaust me to ready a unit.
 *
 * 规则依据（CR v1.5）：
 * - 383.4.c / 383.4.c.1：“When you conquer” 是 Conquer Effect，时点用封闭表的
 *   conquer（turn/flow.ts 的 Score 波次与 scoring/ 发出，ruleRefs 468.5.d / 471.1 /
 *   473.2.a）。生产 EventPattern 的封闭事件名是 "conquered"（events/trigger-spec.ts 的
 *   EVENT_PATTERN_TYPES；events/pipeline-match.ts 的 EVENT_NAMES 把它映射到 conquer 时点），
 *   所以订阅写 "conquered"，不写会被 validateTriggerSpec 以 invalid-event-type 拒绝的
 *   "conquer"。
 * - 383.2.a.1：“if you assigned 3 or more excess damage” 紧跟在触发条件之后，
 *   属于触发条件的一部分，在触发时求值。
 * - 467.2.c：战斗伤害由玩家在战斗伤害步骤分配；467.2.c.2 的 Lethal Damage 与
 *   467.2.c.4 的“除无其他单位可分配外不得超过致命所需”定义了“多于致死的分配量”。
 * - 383.3.b / 383.3.b.1：“you may exhaust me to ready a unit” 中的 “exhaust me”
 *   位于效果开头（紧随 “you may”），按规则是触发能力的基础费用，必须在 Finalize
 *   支付才能把触发放进链；拒绝支付则该触发移出链。
 * - “ready a unit”：任意单位是单个选目标（355.9 / 355.10），用已合入的
 *   effect.ready 执行（416.1–416.3）。
 *
 * status = judge-required（2026-10-18 逐项实测复核）。conquer 时点已由 turn/flow.ts 的
 * Score 波次真实发出；订阅已改用生产事件词表 "conquered"，实测注册成功并在真实 conquer
 * 事件上命中；effect.exhaust / effect.ready 原语与卡牌程序绑定也已合入。
 *
 * 仍缺两处（均不近似实现）：
 * - “if you assigned 3 or more excess damage” 无人可求值：conquer 时点载荷
 *   （timing-points.ts：payloadType "scoring"，未声明 payloadFields）不带本次战斗
 *   伤害分配的总量/超量，ResolveContext 也没有读取伤害分配台账（467.2.c.1 强调
 *   Assigning ≠ Dealing）的入口；契约 3.6 的 history 只按动作计数，无法表达金额。
 *   combat/flow.ts 的 dealDamage 仍在 simultaneous-damage-transaction 抛出，战斗伤害
 *   分配本身没有事务产生方，base-combat-allocation.ts 只产出“已证明无修正”的分配基础。
 *   count 只按 filter 数对象（实测控制者场上 3 个单位即返回 3 而让条件为真），因此保留的
 *   比较用 never 显式阻断，绝不把对象数当作分配伤害量。
 * - 触发能力首段 “exhaust me” 的费用语义（404.1.b.1 / 415.4 / 415.5：费用在
 *   Finalize 支付、付不出时触发无法成立）没有接线：IR 的 TriggeredAbility 没有
 *   CostSpec 字段，用 effect.exhaust 的状态改变代替费用会错过“已横置则不能支付”
 *   的合法性检查。
 * 结构与目标形状保留；effect.exhaust / effect.ready 子指令已可用，golden 用解释器 +
 * 参考内核执行。
 *
 * 依赖：战斗伤害分配的权威回执与 TriggeredAbility 的费用字段。
 */
export default {
  canonicalCardId:
    "card.hash-8e09f40d2b739aa2e5e38a58cb0c9b9a2682ab534807bcc62c90206e763d6856",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "conquer 时点已由 turn/flow.ts 的 Score 波次真实发出，effect.exhaust/effect.ready 与卡牌程序绑定也已合入；" +
    "订阅已改用生产 EventPattern 的封闭事件名 \"conquered\"（events/trigger-spec.ts 的 EVENT_PATTERN_TYPES，" +
    "events/pipeline-match.ts 的 EVENT_NAMES 映射到 conquer 时点），实测注册成功并在真实 conquer 事件上命中。" +
    "整卡仍有两处缺口，均不近似实现：" +
    "(1) “if you assigned 3 or more excess damage” 无可求值路径：" +
    "conquer 时点载荷（payloadType \"scoring\"，未声明 payloadFields）不带本次战斗的伤害分配总量/超量，" +
    "ResolveContext 也没有读取伤害分配台账的入口（467.2.c.1 的 Assigning 与 Dealing 是两件事），" +
    "467.2.c.2–c.4 的 Lethal Damage 与“超出致命所需的分配量”无法表达；combat/flow.ts 的 dealDamage 仍在 " +
    "simultaneous-damage-transaction 抛出，base-combat-allocation.ts 只产出“已证明无修正”的基础分配。" +
    "count 只按 filter 数对象（实测控制者场上 3 个单位即返回 3 而让条件为真），保留的比较用 never 显式阻断，" +
    "禁止以对象数代替分配伤害量。" +
    "(2) 效果开头 “exhaust me” 的费用语义（404.1.b.1 / 415.4 / 415.5：费用在 Finalize 支付、无法支付则该触发移出链）没有接线：" +
    "IR 的 TriggeredAbility 只有 kind/trigger/optional/body，没有 CostSpec 字段，用 effect.exhaust 的状态改变代替费用会漏掉" +
    "“已横置的来源不能支付费用”的检查。" +
    "依赖战斗伤害分配的权威回执与 TriggeredAbility 的费用字段；effect.ready 子指令已合入，golden 实际执行该部分。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "conquer",
        // 生产 EventPattern 的封闭事件名（events/trigger-spec.ts 的 EVENT_PATTERN_TYPES）；
        // events/pipeline-match.ts 的 EVENT_NAMES 把 "conquered" 映射到 conquer 时点。
        filter: { event: "conquered", player: "self" },
        // 383.2.a.1：紧跟触发条件的 “if you assigned 3 or more excess damage” 属于触发条件。
        // 合并 IR 没有伤害分配金额维度，因此用 never 显式 fail closed（禁止以对象数代替分配量）；
        // 保留的 count 只记录缺口形状，台账接入后必须改成真实金额比较。
        condition: {
          kind: "all",
          conditions: [
            { kind: "never" },
            {
              kind: "compare",
              left: {
                kind: "count",
                subject: "excess-damage-assigned-this-combat",
                filter: { player: "controller" }
              },
              operator: "gte",
              right: { kind: "constant", value: 3 }
            }
          ]
        }
      },
      // “you may” 位于效果开头（383.3.a：在 Finalize 决定是否执行该触发；
      // 后续 “exhaust me” 是基础费用，见 judgeReason 与下面的 body 注释）。
      optional: true,
      body: [
        {
          id: "piltover-enforcer.exhaust-self",
          op: "effect.exhaust",
          args: {
            // “exhaust me”：以非目标 choose 的 filter 锚点指向来源自身，不新增目标
            // （355.7）；真实的费用支付语义见 judgeReason。
            choose: {
              kind: "constant",
              value: { id: "piltover-enforcer.exhaust-self", filter: { object: "self" } }
            }
          }
        },
        {
          id: "piltover-enforcer.ready-unit",
          op: "effect.ready",
          linkedTo: "piltover-enforcer.exhaust-self",
          args: {
            // effect.ready 缺省选择器是 source，因此这里显式指向 “ready a unit” 的目标。
            objects: { kind: "constant", value: { kind: "target", id: "piltover-enforcer.unit" } }
          },
          targets: [
            {
              id: "piltover-enforcer.unit",
              filter: { zone: "board", type: "unit" },
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
    "When you conquer, if you assigned 3 or more excess damage, you may exhaust me to ready a unit."
} satisfies CardProgram;

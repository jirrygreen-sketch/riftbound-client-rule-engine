import type { CardProgram } from "../../ir/index.js";

/**
 * Frigid Jewel (unl-074-219) — Gear, 2 energy、power null（无印刷 Power）、Might null，
 * 领域 Mind，无标签。
 *
 * sourceText（逐字取自 packages/card-data/data/deck-catalog.json unl-074-219）：
 *   "When you draw your second card each turn, give a friendly unit +2 :rb_might:
 *    this turn."
 *
 * 规则依据（CR v1.5）：
 * - 383.1：“the [Nth] time” 加游戏动作/事件是触发能力的识别方式；本卡以
 *   “when you draw your second card each turn” 表述“本回合你抽第二张牌的时刻”，
 *   时点用封闭表的 card-drawn（payloadFields 含 drawIndexThisTurn，即“本回合第几张”）。
 * - 383.1.b：Nth-time 型触发条件同时满足多次时，控制者挑其中一个作为触发条件，能力
 *   只触发一次；本卡用 TriggerSpec.once: "per-turn" 表达“每回合一次”的记账
 *   （events/pipeline.ts 的 frequencyKey 按 [registration, source, scope, turn] 记账）。
 * - 355.10 / 355.9.a.1：“give a friendly unit …” 中的 “unit” 默认指 Board 上的对象，
 *   且由玩家选择，因此是选目标（targets），不是 pick（355.7）。
 * - “+2 :rb_might: this turn” 是本回合到期（end-of-turn）的临时 Might 修正：
 *   effect.buff 的文件头明确临时 Might 改变属于 layers 的 continuous.might，而
 *   702/703 的 Buff 计数器是另一件事（已合入 ogn/darius-trifarian、unl/pridestalker、
 *   ogn/blastcone-fae 同型判定）。
 *
 * status = judge-required（缺口不近似实现；已按合入依赖复核）：
 * 1. 剩余缺口：“your second card each turn” 仍无可求值路径。card-drawn 载荷的
 *    drawIndexThisTurn（“本回合第几张”）要在触发进链前判定（383.2.a.1），而
 *    events/pipeline.ts 对任何带 condition 的注册要求宿主提供 testTrigger 适配器
 *    （"Trigger condition adapter required"，没有任何已合入 host 实现它）；Condition/Expr
 *    自身也没有读取事件载荷的通道，HistoryQuery 只按动作/时点计数、不表达序号。
 *    count 表达式只是保留形状，不把“第二张”放宽成“任意抽牌”。
 * 2. 已解决：“+2 :rb_might: this turn” 由已合入的 continuous.might 原语执行：
 *    它经 ctx.addContinuous 注册 arithmetic 层效果，this-turn 映射为 end-of-turn 期限
 *    （317.1.a / 468.7.c / 479.4）；指令用契约 3.6 的 objects 选择器指回自己声明的
 *    TargetSpec，golden 用链适配器真实执行并断言注册、有效 Might 与到期。
 * 3. 已解决：卡牌程序 → TriggerRegistration 的接线已合入，card-drawn 触发可被注册。
 * 依赖：触发条件宿主求值（host.testTrigger）与事件载荷读取。
 */
export default {
  canonicalCardId:
    "card.hash-7f0b19222fb898be4cda4e745fed0f0dccc5d8ef52e41e5d57c48a67ba743618",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "（2026-10-18 复核）(1) “本回合抽到的第二张牌” 仍无可求值路径：card-drawn 载荷的 drawIndexThisTurn 要在触发进链前判定（383.2.a.1），" +
    "而 events/pipeline.ts 对带 condition 的注册要求宿主提供 testTrigger 适配器（没有任何已合入 host 实现它），" +
    "Condition/Expr 也不能读取事件载荷（HistoryQuery 只按动作/时点计数，不表达序号）；count 表达式是保留形状，" +
    "不把“第二张”近似成“任意抽牌”。" +
    "(2) 已解决：“+2 :rb_might: this turn” 由已合入的 continuous.might 原语执行——经 ctx.addContinuous 注册 arithmetic 层效果，" +
    "this-turn → end-of-turn 期限（317.1.a / 468.7.c），指令用 objects 选择器指回自己声明的 TargetSpec；golden 已用链适配器真实执行。" +
    "(3) 已解决：卡牌程序 → TriggerRegistration 的接线已合入。" +
    "依赖：触发条件宿主求值（host.testTrigger）与事件载荷读取；不近似实现。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "card-drawn",
        filter: {
          event: "card-drawn",
          // “you draw”：抽牌者是能力控制者（190.6.d）。
          player: "self"
        },
        // 383.2.a.1：“your second card each turn” 紧跟触发条件，属于触发条件，
        // 在进链前求值。语义上要读的是 card-drawn 载荷的 drawIndexThisTurn == 2
        // （含刚抽到的这张），这里用等价的 count 表达式保留形状
        // （事件载荷读取与 testTrigger 适配器缺口见 judgeReason），不把“第二张”放宽成任意抽牌。
        condition: {
          kind: "compare",
          left: {
            kind: "count",
            subject: "cards-drawn-this-turn",
            filter: { player: "controller" }
          },
          operator: "eq",
          right: { kind: "constant", value: 2 }
        },
        // 383.1.b：Nth-time 触发每回合只执行一次。
        once: "per-turn"
      },
      optional: false,
      body: [
        {
          id: "frigid-jewel.grant-might",
          // 已合入的 continuous.might 原语固定 arithmetic 层；objects 用契约 3.6
          // 的选择器指回本指令声明的 TargetSpec（缺省选择器是来源自身）。
          op: "continuous.might",
          args: {
            amount: { kind: "constant", value: 2 },
            duration: { kind: "constant", value: "end-of-turn" },
            objects: {
              kind: "constant",
              value: { kind: "target", id: "frigid-jewel.friendly-unit" }
            }
          },
          targets: [
            {
              id: "frigid-jewel.friendly-unit",
              // “a friendly unit”：由能力控制者选择的 Board 单位（355.10 / 355.9.a.1）。
              filter: { zone: "board", type: "unit", controller: "controller" },
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
    "When you draw your second card each turn, give a friendly unit +2 :rb_might: this turn."
} satisfies CardProgram;

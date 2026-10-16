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
 * status = judge-required（缺口不近似实现）：
 * 1. “your second card each turn” 的可求值路径缺失：card-drawn 时点虽然声明了
 *    drawIndexThisTurn 载荷字段，但卡牌触发条件的求值入口（Condition/Expr）没有读取
 *    事件载荷的通道——Condition 只能读对象特征、链接值与对象计数，count 表达式不读
 *    事件载荷；合并 IR 也没有已注册的 condition.history 消费方（HistoryQuery 只按
 *    动作/时点计数，不表达“第几张”的序号）。count 表达式只是保留形状。
 * 2. “give a friendly unit +2 Might this turn” 无原语：契约 3.6 的封闭 GameAction 集合
 *    没有 might 修改动作，effects/instructions/ 下没有 continuous.might 文件，卡牌程序
 *    也无法把该持续效果注册进 layers（ctx.addContinuous 没有原语消费者）。
 * 3. 缺少卡牌程序 → TriggerRegistration 的接线（契约 3.5），card-drawn 触发不会被注册。
 * 依赖：引擎批 4 的事件载荷/触发条件求值（RIFT-120 后续）、RIFT-91（layers 的卡牌接入）。
 */
export default {
  canonicalCardId:
    "card.hash-7f0b19222fb898be4cda4e745fed0f0dccc5d8ef52e41e5d57c48a67ba743618",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "(1) “本回合抽到的第二张牌” 无可求值路径：触发条件需要读取 card-drawn 事件载荷的 drawIndexThisTurn（“本回合第几张”），" +
    "但 Condition/Expr 只能读对象特征、链接值与对象计数，没有读取事件载荷的通道；HistoryQuery 只按动作/时点计数，不表达序号，" +
    "condition.history 也没有已注册的卡牌侧消费方。count 表达式是保留形状，不把“第二张”近似成“任意抽牌”。" +
    "(2) “+2 :rb_might: this turn” 无原语：契约 3.6 的封闭 GameAction 集合没有 might 修改动作，" +
    "effects/instructions/ 下没有 continuous.might 文件，卡牌程序也没有把该持续效果注册进 layers 的指令入口" +
    "（effect.buff 明确临时 Might 归 continuous.might，702/703 的 Buff 计数器是另一件事）。" +
    "(3) 缺少卡牌程序 → TriggerRegistration 的接线（契约 3.5）。" +
    "依赖引擎批 4 的事件载荷与触发条件求值（RIFT-120 后续）与 RIFT-91（layers 的卡牌接入）；不近似实现。",
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
        // （事件载荷读取缺口见 judgeReason），不把“第二张”放宽成任意抽牌。
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
          op: "continuous.might",
          args: {
            amount: { kind: "constant", value: 2 },
            duration: { kind: "constant", value: "end-of-turn" }
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

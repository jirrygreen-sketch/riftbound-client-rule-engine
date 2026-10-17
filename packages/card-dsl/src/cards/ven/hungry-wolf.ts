import type { CardProgram } from "../../ir/index.js";

/**
 * Hungry Wolf (ven-125-166) — Unit, 4 Energy, 4 Might, Order, Dog/Freljord.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-125-166，逐字）：
 *   :rb_rune_order:: Ready me and give me +1 :rb_might: this turn. Use only if
 *   you've chosen an enemy unit this turn and only once each turn.
 *
 * 规则依据（CR v1.5）：
 * - 377/378/404.1.a：冒号前的 “:rb_rune_order:” 是启动费用（一枚 Order Power，
 *   163.2、404.1.a），后续文本是启动能力的效应；契约 3.1 用 activated + CostSpec
 *   记录该费用，Finalize / 费用管线负责校验与收缴。
 * - 415 / 416.1：“Ready me” 用已合入的 effect.ready（宿主自身即能力来源，
 *   355.10.g、412.4）。
 * - “give me +1 :rb_might: this turn” 是带回合期限的临时 Might 修正：effect.buff 的
 *   边界注释明确 Buff 计数器（702）不是临时 Might，该修正属 layers 的
 *   continuous.might + continuous.duration（315.4 / 清理步骤到期）。RIFT-258 已合入
 *   continuous.might 指令原语（ctx.addContinuous 注册 arithmetic 层效果），本卡用它
 *   注册 +1 与本回合期限。
 * - “Use only if you've chosen an enemy unit this turn” 是启动限制（355.7 的选择
 *   历史）：封闭 HistoryQuery 只有 scope/action/timingPoint/player/object/exclude/
 *   objectFilter，GameAction 集合里没有“选择敌方单位”动作，无法按选择历史计数。
 * - “only once each turn” 是能力次数限制（386.1）：契约 3.1 的 activated 能力没有
 *   per-turn 许可字段（TriggerOnce 只作用于触发式能力），也没有最终校验消费方。
 *
 * status = judge-required（两处缺口均不近似实现）：
 * 1. “Use only if you've chosen an enemy unit this turn” 是启动限制（355.7 的选择
 *    历史）：condition.history 的封闭 HistoryQuery 只有 scope/action/timingPoint/
 *    player/object/exclude/objectFilter，GameAction 集合里没有“选择敌方单位”动作，
 *    触发式能力的 condition 也无法作用到启动能力的许可；
 * 2. “only once each turn” 是 386.1 的能力次数限制：activated 能力没有 per-turn
 *    许可字段（TriggerOnce 只作用于触发式能力），Finalize 侧也没有消费方
 *    （translateRestriction 只接受 Condition 形状，描述性 printed-use-limit 会被判为
 *    judge-required）。
 *
 * 已合入部分的执行证据：“Ready me”（effect.ready）与 “+1 :rb_might: this turn”
 * （continuous.might + this-turn 期限）都用真实解释器执行，golden 断言实际事件、
 * arithmetic 层注册与 turn-end 到期。
 */
export default {
  canonicalCardId: "card.hash-c57951db37608d30432354f25a074c018c9b41aa44a03a6ee3b5b4be3ec93ad1",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处缺口：(1) “Use only if you've chosen an enemy unit this turn” 是启动限制：condition.history 的封闭 " +
    "HistoryQuery 只有 scope/action/timingPoint/player/object/exclude/objectFilter，GameAction 集合内没有“选择敌方单位”" +
    "动作，无法按选择历史计数（条件/历史管线的“选择”动作是真实缺口）；(2) “only once each turn” 是 386.1 的能力次数" +
    "限制，activated 能力没有 per-turn 许可字段（TriggerOnce 只作用于触发式能力），Finalize 侧也没有" +
    "消费方，translateRestriction 只接受 Condition 形状（描述性 printed-use-limit 会被判为 " +
    "judge-required）。两处均不近似实现。" +
    "“Ready me” 用已合入的 effect.ready，“+1 :rb_might: this turn” 用 RIFT-258 已合入的 " +
    "continuous.might（this-turn 期限）真实执行。",
  abilities: [
    {
      kind: "activated",
      timing: "action",
      cost: {
        kind: "activated",
        // 印刷费 :rb_rune_order: = 一枚 Order Power（163.2、404.1.a）。
        power: { kind: "constant", value: ["Order"] }
      },
      // “only once each turn” / “use only if you've chosen an enemy unit this
      // turn” 没有可执行的建模字段（见 judgeReason），只如实记录原文限制。
      restriction: {
        kind: "printed-use-limit",
        value: { kind: "constant", value: "once-each-turn-chosen-enemy-unit-this-turn" }
      },
      body: [
        {
          id: "hungry-wolf.ready-me",
          op: "effect.ready",
          args: {}
        },
        {
          // “give me +1 [M] this turn”：RIFT-258 的 continuous.might 注册 arithmetic 层
          // 效果（478.1.a），duration "this-turn" 由 317.1.a / 468.7.c 在 turn-end 到期。
          // 不写成 Buff（702 的计数器语义不同）。
          id: "hungry-wolf.might-this-turn",
          op: "continuous.might",
          args: {
            amount: { kind: "constant", value: 1 },
            duration: { kind: "constant", value: "this-turn" },
            objects: { kind: "constant", value: { kind: "source" } }
          }
        }
      ]
    }
  ],
  sourceText:
    ":rb_rune_order:: Ready me and give me +1 :rb_might: this turn. " +
    "Use only if you've chosen an enemy unit this turn and only once each turn."
} satisfies CardProgram;

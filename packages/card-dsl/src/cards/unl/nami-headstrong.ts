import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Nami, Headstrong (unl-052-219) — Unit, 3 Energy、无印刷力量值，Might 3，Calm，
 * tag Mount Targon/Nami/Champion。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-052-219，逐字，含换行）：
 *   You may pay :rb_rune_calm: as an additional cost to play me.
 *   When you play me, if you paid the additional cost, [Stun] an enemy unit.
 *   (It doesn't deal combat damage this turn.)
 *   When I hold, the next time you play a unit this turn, ready it and [Buff] it.
 *
 * 规则依据（CR v1.5）：
 * - 204.2 / 204.2.a / 356.2.b / 356.2.b.1："You may pay :rb_rune_calm: as an
 *   additional cost to play me." 是**可选附加费用**（由被播放卡上的被动能力给出、带 may），
 *   在打出流程的第 2 步声明、356.2 应用、357.2 支付；费用内容按 163.2 是 1 点 Calm Power。
 *   卡牌只声明这条附加费（契约 3.1 的 CostSpec 形态），支付归费用计划（RIFT-89）。
 * - 383.4.a / 383.2.a.1："When you play me" 是 Play Effect（时点 card-played，自身）；
 *   紧跟在触发条件之后的 "if you paid the additional cost" 属于触发条件（不是效果内条件），
 *   它读的是 356.4.f.1 的"已作出支付决定"收据（见 judgeReason）。
 * - 424.1："[Stun] an enemy unit" 是 Stun 动作（把 Board 上一个敌方单位渲染为 Stunned），
 *   由已合入的 effect.stun 执行；括号内是同一动作的结果释义（135.2.d.1/d.3 提醒文字
 *   不影响规则），不另写指令。
 * - 391.2 / 391.3："the next time you play a unit this turn" 描述一个**延迟触发**
 *   （时间窗为"本回合内的下一次"），不是立即结算的指令；393 规定延迟能力由其他能力创建。
 * - 414.1 / 416.1 / 702.2.a："ready it and [Buff] it" 是对那个被播放单位的重置与 Buff
 *   （effect.ready / effect.buff，两者均已合入），"it" 是触发事件的对象。
 *
 * status = judge-required（缺口不近似实现）：
 * - 可选附加费用的声明没有消费者：effects/instructions/ 只有 effect.* 文件，没有
 *   cost.additional / cost.pay 原语，也没有把 CardProgram 的 CostSpec 接进
 *   cost/cost-plan.ts 的 optionalAdditional 输入（契约 3.1 的 CostSpec 只被声明）；
 * - "if you paid the additional cost" 需要费用凭证（356.4.f.1 的 paid 收据）进入条件求值，
 *   合并 IR 的 Condition 没有 condition.result；程序里只保留
 *   compare(count("paid-additional-cost"), gte, 1) 的**保留形状**——真实内核下该计数为 0，
 *   条件是假的，因此 Stun 不会无条件发生（与 piltover-enforcer/virtuoso 同一写法）。
 * - "the next time you play a unit this turn" 需要延迟触发注册与"下一次"窗口：RIFT-9 清单中的
 *   trigger.delayed 没有已注册的 InstructionDef，ResolveContext.registerDelayedTrigger 只有
 *   引擎内部调用方，TriggerSpec.once 也只有 per-turn/per-combat/per-chain/per-game；
 * - "ready it and [Buff] it" 的 "it" 是延迟触发的事件对象（被打出的那个单位），合并
 *   ObjectSelector 只有 self/source/target/pick/linked，没有事件对象选择器；程序里的
 *   TargetSpec 只是形状保留（virtuoso 同型），真实绑定须由触发系统在生成延迟触发时完成。
 *
 * 依赖：RIFT-89（可选附加费用与费用凭证）、引擎批 4/5 的延迟触发注册（trigger.delayed）
 * 与事件对象选择器；不近似实现。
 */

/** "the unit you played" —— 延迟触发的事件对象（形状保留，见 judgeReason）。 */
const PLAYED_UNIT = "nami-headstrong.played-unit";

const abilities: Ability[] = [
  {
    // 356.2.b / 356.2.b.1：由被播放卡上的被动能力给出的可选附加费用
    // （1 点 Calm Power，163.2）。费用计划与支付属 RIFT-89；卡牌只声明形状。
    kind: "static",
    effect: {
      kind: "cost.additional",
      id: "nami-headstrong.additional-cost",
      appliesTo: "self",
      optional: true,
      stage: "optional-additional",
      payments: [
        {
          kind: "power",
          amount: { kind: "constant", value: 1 },
          allowedDomains: ["Calm"]
        }
      ]
    }
  },
  {
    // 383.4.a："When you play me" 的 Play Effect。
    kind: "triggered",
    trigger: {
      at: "card-played",
      filter: { event: "card-played", filter: { source: "self" } },
      // 383.2.a.1：紧跟触发条件的 "if you paid the additional cost" 属于触发条件。
      // 保留形状：合并 IR 没有费用凭证（condition.result），count 只数对象、
      // 这里恒为 0 → 条件为假、该触发不成立，不会无条件 Stun（见 judgeReason）。
      condition: {
        kind: "compare",
        left: {
          kind: "count",
          subject: "paid-additional-cost",
          filter: { player: "controller" }
        },
        operator: "gte",
        right: { kind: "constant", value: 1 }
      }
    },
    optional: false,
    body: [
      {
        id: "nami-headstrong.stun-enemy-unit",
        op: "effect.stun",
        args: {
          target: { kind: "constant", value: "nami-headstrong.enemy-unit" }
        },
        targets: [
          {
            id: "nami-headstrong.enemy-unit",
            // 424.1 / 355.9.a.1："an enemy unit" 是 Board 上由对手控制的单位。
            filter: { type: "unit", zone: "board", controller: "opponent" },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      }
    ]
  },
  {
    // 383.4.d："When I hold" 的 Hold Effect。
    kind: "triggered",
    trigger: { at: "hold", filter: { event: "hold", filter: { source: "self" } } },
    optional: false,
    body: [
      {
        id: "nami-headstrong.delayed-next-unit",
        // RIFT-9 清单中的延迟触发注册（未注册 op，见 judgeReason）：窗口为"本回合的下一次"。
        op: "trigger.delayed",
        args: {
          at: { kind: "constant", value: "card-played" },
          filter: { kind: "constant", value: { type: "unit", controller: "controller" } },
          window: { kind: "constant", value: "next-time-this-turn" },
          body: {
            kind: "constant",
            value: [
              {
                id: "nami-headstrong.ready-played-unit",
                // 416.1："ready it"；目标引用是形状保留（事件对象选择器缺失）。
                op: "effect.ready",
                args: {
                  objects: { kind: "constant", value: { target: PLAYED_UNIT } },
                  amount: { kind: "constant", value: 1 }
                },
                targets: [
                  {
                    id: PLAYED_UNIT,
                    // 355.9.a.1："it" 是被打出的那个单位（非本卡）。
                    filter: { type: "unit", zone: "board", controller: "controller" },
                    min: 1,
                    max: 1,
                    selection: "one"
                  }
                ]
              },
              {
                id: "nami-headstrong.buff-played-unit",
                // 702.2.a："[Buff] it" 给那个单位放置一个 Buff counter；已有 Buff 的单位
                // 仍可被选择但不新增（702.3 / 702.3.a）。
                op: "effect.buff",
                args: {
                  mode: { kind: "constant", value: "buff" },
                  target: { kind: "constant", value: PLAYED_UNIT }
                },
                targets: [
                  {
                    id: PLAYED_UNIT,
                    filter: { type: "unit", zone: "board", controller: "controller" },
                    min: 1,
                    max: 1,
                    selection: "one"
                  }
                ]
              }
            ]
          }
        }
      }
    ]
  }
];

export default {
  canonicalCardId:
    "card.hash-a9a744726a85225a5f09812cc8545795d64c7f24f2a06e46af7895230c6deeb2",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "四处缺口，均不近似实现：（1）可选附加费用『You may pay :rb_rune_calm: as an additional cost to play me.』" +
    "（204.2 / 356.2.b / 356.2.b.1）没有消费者：effects/instructions/ 只有 effect.* 文件，没有 cost.additional / cost.pay 原语，" +
    "也没有把 CardProgram 的 CostSpec 接进 cost/cost-plan.ts 的 optionalAdditional 输入。" +
    "（2）『if you paid the additional cost』需要 356.4.f.1 的费用凭证（作出支付决定的收据）进入条件求值，" +
    "合并 IR 的 Condition 没有 condition.result；程序保留 count(subject \"paid-additional-cost\") 的比较形状，" +
    "真实内核下该计数为 0、条件为假，所以不会无条件 Stun（不近似实现）。" +
    "（3）『the next time you play a unit this turn』需要延迟触发注册与『下一次』窗口：" +
    "RIFT-9 清单里的 trigger.delayed 没有已注册的 InstructionDef，ResolveContext.registerDelayedTrigger 只有引擎内部调用方，" +
    "TriggerSpec.once 也只有 per-turn / per-combat / per-chain / per-game，没有 next-time 窗口。" +
    "（4）『ready it and [Buff] it』的 it 是延迟触发的事件对象（被打出的那个单位），合并 ObjectSelector 只有 " +
    "self / source / target / pick / linked，没有事件对象选择器；程序里的 TargetSpec 只是形状保留，" +
    "真实绑定须由触发系统在生成延迟触发时完成。" +
    "依赖：RIFT-89（可选附加费用与费用凭证）、引擎批 4/5 的延迟触发注册（trigger.delayed）与事件对象选择器。" +
    "effect.stun / effect.ready / effect.buff 本体均已合入，golden 对它们做真实执行。",
  abilities,
  sourceText:
    "You may pay :rb_rune_calm: as an additional cost to play me.\n" +
    "When you play me, if you paid the additional cost, [Stun] an enemy unit. (It doesn't deal combat damage this turn.)\n" +
    "When I hold, the next time you play a unit this turn, ready it and [Buff] it."
} satisfies CardProgram;

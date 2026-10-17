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
 *   卡牌只声明这条附加费（契约 3.1 的 CostSpec 形态），支付由费用计划处理。
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
 * 2026-10-17 复核：仍为 judge-required，当前缺口见 judgeReason。
 * 已有原语、关键词定义或通用适配器不代表本卡完整生产路径可执行。
 */

/** "the unit you played" —— 延迟触发的事件对象（形状保留，见 judgeReason）。 */
const PLAYED_UNIT = "nami-headstrong.played-unit";

const abilities: Ability[] = [
  {
    // 356.2.b / 356.2.b.1：由被播放卡上的被动能力给出的可选附加费用
    // （1 点 Calm Power，163.2）。卡牌只声明费用形状，费用计划负责支付。
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
      // 356.4.f.1：读取这一项可选附加费的支付决定，而非计数局面中的对象。
      // 谓词已可执行；原始打出回执到触发环境的传递仍缺失（见 judgeReason）。
      condition: {
        kind: "result",
        result: "cost.additional",
        id: "nami-headstrong.additional-cost"
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
        // 延迟触发注册仍待接线（见 judgeReason）：窗口为"本回合的下一次"。
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
    "缺静态 cost.additional 声明到 Finalize optionalAdditional 的翻译（204.2/356.2.b.1），programs/statics.ts 不映射费用声明。" +
    "condition.result 已能读取真实费用计划/支付回执；仍缺把原始打出费用回执传给 card-played 的触发条件（356.4.f.1），events/pipeline.ts 的条件环境只传 event/context，未传 cost。" +
    "Hold 的 hold 事件名仍与封闭 EventPattern 的 held 不一致；缺 trigger.delayed InstructionDef、next-time-this-turn 的一次性本回合窗口（391.2/391.3），" +
    "以及将延迟事件里被打出的单位绑定给 ready/Buff 的对象引用；现有 TargetSpec 仅保留该对象范围，不能代替事件对象绑定。",
  abilities,
  sourceText:
    "You may pay :rb_rune_calm: as an additional cost to play me.\n" +
    "When you play me, if you paid the additional cost, [Stun] an enemy unit. (It doesn't deal combat damage this turn.)\n" +
    "When I hold, the next time you play a unit this turn, ready it and [Buff] it."
} satisfies CardProgram;

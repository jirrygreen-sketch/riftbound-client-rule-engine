import type { CardProgram } from "../../ir/index.js";

/**
 * Fresh Beans (unl-011-219) — Gear, 2 energy、power null（无印刷 Power）、
 * Might null，领域 Fury，无标签。
 *
 * sourceText（逐字取自 packages/card-data/data/deck-catalog.json unl-011-219）：
 *   "When you play a unit during a showdown, you may exhaust this to draw 1."
 *
 * 规则依据（CR v1.5）：
 * - 383.4.a.4："When you play a unit" 是“当另一个对象被打出时触发”的能力，不是 Play
 *   Effect；时点用封闭表的 card-played，事件对象是刚打出的单位、打出者是能力控制者
 *   （190.6.d 的 "you"）。
 * - 383.2.a.1："during a showdown" 是紧跟触发条件的限定，属于触发条件的一部分，在进链前
 *   求值（见 judgeReason：当前没有该状态的求值入口，count 表达式只是保留形状）。
 * - 383.3.a / 383.3.a.2：效果最开头的 "you may" 由触发能力本身的 optional 承载——
 *   控制者在 Finalize 决定是否执行；拒绝则该触发移出链。
 * - 383.3.b / 404.1.b.1：紧跟 "you may" 的 "exhaust this" 是成本内指令，按规则是该触发
 *   能力的基础费用（415.4/415.5：付不出就不能进链）。冻结 IR 的 TriggeredAbility 没有
 *   cost 字段，这里按已合入先例（ogn/relentless-storm、unl/piltover-enforcer）用非目标
 *   choose 锚定来源自身执行 effect.exhaust，并把抽牌链接在其后。
 * - 414.3："draw 1" 用已合入的 effect.draw，抽牌者隐含为能力控制者（190.6.d）。
 *
 * status = judge-required（缺口不近似实现）：
 * - "during a showdown" 无可求值路径：封闭时点表只提供 showdown-open / showdown-close
 *   事件，Condition/Expr 没有读取“当前是否处于 Showdown”的入口
 *   （ObjectSnapshot/PlayerSnapshot 都没有该维度），count 只做对象集合计数。
 * - "exhaust this" 的费用语义（383.3.b / 404.1.b.1：Finalize 支付，来源已横置时不能支付、
 *   415.1.b/c）没有接线：TriggeredAbility 无 cost 字段，也没有注册的 cost.pay 指令原语。
 * - 缺少卡牌程序 → TriggerRegistration 的接线（契约 3.5）。
 * effect.exhaust 与 effect.draw 本身已合入，golden 用解释器 + 参考内核分别真实执行。
 * 依赖：RIFT-89（费用接线）、RIFT-120 后续（触发注册与条件求值）、Showdown 状态读取。
 */
export default {
  canonicalCardId:
    "card.hash-17039d43b30b27ad3b262ad062f057e1b19e43c616105e2847e33e5fc6370cbc",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "(1) “during a showdown” 无可求值路径：Showdown 的进行中状态只有 showdown-open/showdown-close 时点，" +
    "Condition/Expr 没有读取“当前是否处于 Showdown”的入口（ObjectSnapshot/PlayerSnapshot 都没有该维度，" +
    "count 只做对象集合计数），383.2.a.1 的触发条件无法判定。" +
    "(2) “exhaust this” 是 383.3.b / 404.1.b.1 的触发能力基础费用（415.4/415.5：来源已横置则不能支付、" +
    "该触发移出链），但冻结 IR 的 TriggeredAbility 没有 cost 字段，指令层也没有注册的 cost.pay，" +
    "合并管线没有把 “you may [do X] to [do Y]” 解析成触发费用的路径。" +
    "(3) 缺少卡牌程序 → TriggerRegistration 的接线（契约 3.5），card-played 触发目前不会被注册。" +
    "依赖 RIFT-89（费用接线）、RIFT-120 后续（触发注册/条件求值）与 Showdown 状态读取；" +
    "effect.exhaust 与 effect.draw 已合入并单独执行，不据此宣称整卡可执行。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "card-played",
        filter: {
          event: "card-played",
          // “you play a unit”：事件对象是刚打出的单位，打出者是能力控制者（190.6.d）。
          object: { type: "unit" },
          player: "self"
        },
        // 383.2.a.1：“during a showdown” 是触发条件的一部分，在进链前求值；
        // count 表达式是保留形状（Showdown 状态读取缺口见 judgeReason）。
        condition: {
          kind: "compare",
          left: {
            kind: "count",
            subject: "open-showdowns",
            filter: { player: "controller" }
          },
          operator: "gte",
          right: { kind: "constant", value: 1 }
        }
      },
      // 383.3.a：效果最开头的 “you may” 是触发能力本身的 Finalize 决定。
      optional: true,
      body: [
        {
          id: "fresh-beans.exhaust-self",
          op: "effect.exhaust",
          args: {
            // “exhaust this”：以非目标 choose 的 filter 锚点指向来源自身，不新增目标
            // （355.7）；383.3.b 的费用语义见 judgeReason。
            choose: {
              kind: "constant",
              value: { id: "fresh-beans.exhaust-self", filter: { object: "self" } }
            }
          }
        },
        {
          id: "fresh-beans.draw-1",
          // “exhaust this to draw 1”：抽牌以横置成功为前提（359.3.e.14 链接传播）。
          linkedTo: "fresh-beans.exhaust-self",
          op: "effect.draw",
          args: { amount: { kind: "constant", value: 1 } }
        }
      ]
    }
  ],
  sourceText: "When you play a unit during a showdown, you may exhaust this to draw 1."
} satisfies CardProgram;

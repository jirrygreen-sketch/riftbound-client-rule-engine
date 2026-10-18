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
 * status = judge-required（已按合入依赖复核，缺口不近似实现）：
 * - 剩余缺口一：“during a showdown” 无可求值路径（383.2.a.1）。带 condition 的触发注册要求宿主提供
 *   testTrigger 适配器（events/pipeline.ts 抛 "Trigger condition adapter required"，没有任何已合入 host 实现它），
 *   Condition/Expr 也没有读取“当前是否处于 Showdown”的入口（ObjectSnapshot/PlayerSnapshot 都没有该维度，
 *   count 只做对象集合计数）。
 * - 剩余缺口二：“exhaust this” 的触发基础费用（383.3.b / 404.1.b.1 / 415.4/415.5）没有接线：TriggeredAbility 没有
 *   cost 字段，来源已横置时无法让该触发支付失败并移出链；费用种类和 cost.pay 本体虽已合入，
 *   触发能力的基础费用槽位仍缺失。
 *   另外本卡触发体用非目标的 choose 锚点表达该费用，而 chain/interpreter-adapter.ts 的 LITERAL_FIELDS 只解码
 *   effect.exhaust 的 target/pick/choice，choose 字面量会被原语拒绝，生产适配器跑不了 as-written 的整条 body。
 * - 已解决的部分：卡牌程序 → TriggerRegistration 的生产接线（programs/triggers.ts）已合入，card-played
 *   触发会被注册；effect.exhaust 与 effect.draw 本体已合入，golden 用解释器 + 参考内核分别真实执行。
 * 依赖：TriggeredAbility 的触发基础费用槽位、触发条件求值与 Showdown 状态读取。
 */
export default {
  canonicalCardId:
    "card.hash-17039d43b30b27ad3b262ad062f057e1b19e43c616105e2847e33e5fc6370cbc",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "（2026-10-18 复核）(1) “during a showdown” 无可求值路径（383.2.a.1）：events/pipeline.ts 对带 condition 的注册要求宿主提供 testTrigger 适配器（没有任何已合入 host 实现它），" +
    "Condition/Expr 也没有读取“当前是否处于 Showdown”的入口（ObjectSnapshot/PlayerSnapshot 都没有该维度，count 只做对象集合计数）。" +
    "(2) “exhaust this” 是 383.3.b / 404.1.b.1 的触发能力基础费用（415.4/415.5：来源已横置则不能支付、该触发移出链），" +
    "但冻结 IR 的 TriggeredAbility 没有 cost 字段；cost.pay 本体已合入却不能承接该触发基础费用，本卡触发体用非目标 choose 锚点表达该费用，" +
    "而 chain/interpreter-adapter.ts 的 LITERAL_FIELDS 只解码 effect.exhaust 的 target/pick/choice，choose 字面量会被原语拒绝，生产适配器跑不了 as-written 的整条 body。" +
    "(3) 已解决：卡牌程序 → TriggerRegistration 的生产接线（programs/triggers.ts）已合入，card-played 触发会被注册；" +
    "effect.exhaust 与 effect.draw 本体已合入并单独执行，不据此宣称整卡可执行。依赖触发基础费用槽位、触发条件求值与 Showdown 状态读取。",
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

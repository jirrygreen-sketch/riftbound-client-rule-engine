import type { CardProgram } from "../../ir/index.js";

/**
 * Spirit Wheel (sfd-144-221) — Gear, 2 energy, Might null, Chaos, 无标签。
 *
 * sourceText（逐字取自 packages/card-data/data/deck-catalog.json sfd-144-221）：
 *   "When you choose a friendly unit, you may pay :rb_energy_1: and exhaust this to draw 1."
 *
 * 规则依据（CR v1.5）：
 * - 383.4.b / 383.4.b.1 / 383.4.b.3："When you choose …" 是 Targeting Effect——条件为某个
 *   Game Object 成为目标；355.6/355.7 规定"choose"指定具体对象即受 Targeting 约束。封闭
 *   时点里对应 became-target（events/timing-points.ts，ruleRefs 355.7/383.4.b）。
 * - "a friendly unit"：740.1.a 的 friendly = 与该能力控制者同控制者；事件目标用
 *   ObjectFilter 的 PlayerSelector "self"（引擎把它解析为"等于触发控制者"）。
 * - "you may pay :rb_energy_1: and exhaust this to draw 1"：383.3.b / 383.3.b.1 规定紧跟
 *   效果开头 "you may" 的 [do X] to [do Y] 是该触发能力的基础费用，必须在 Finalize 支付；
 *   383.3.a 的"是否执行"决定由 TriggeredAbility.optional 承载，契约 3.9 要求把被选择的
 *   指令包进 choice.optional 的 body（不用 choice + linkedTo）。
 * - "draw 1"：414.1 / 414.3，抽牌者缺省为能力控制者（190.6.d）。
 *
 * status = judge-required（缺触发接线与成本内费用原语，不近似实现）：
 * - 触发侧：没有已合入模块把卡牌程序的 triggered 能力注册成 TriggerRegistration
 *   （events/pipeline.ts 只有引擎内部的 delayed 注册路径），became-target 虽由
 *   chain/engine.ts 的 TargetPlan finalize 发出，但没有卡牌程序订阅方（契约 3.5，RIFT-120 后续）。
 * - 费用侧："pay :rb_energy_1: and exhaust this" 按 383.3.b 是基础费用，但契约 3.1 的
 *   TriggeredAbility 没有 cost 字段，指令层也没有已注册的 cost.pay 原语（effects/instructions/
 *   只有 effect.* 原语）；费用计划与 Finalize 收费管线未接通（RIFT-89）。
 * - 已可真实执行的部分：effect.draw 本体（golden 用参考内核执行）。
 */
export default {
  canonicalCardId: "card.hash-498c7e8ce2e20ef011de716db7cf2ff6e0f71a410cc40dace65553df8b0b2518",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处缺口：(1) 触发侧没有卡牌程序→TriggerRegistration 的订阅方（became-target 由 chain/engine.ts " +
    "的 TargetPlan finalize 发出，但没有模块把卡牌程序的 triggered 能力注册进 events/pipeline，契约 3.5，RIFT-120 后续）；" +
    "(2) 费用侧「you may pay :rb_energy_1: and exhaust this」按 CR 383.3.b/383.3.b.1 是该触发能力的" +
    "基础费用、必须在 Finalize 支付，但契约 3.1 的 TriggeredAbility 没有 cost 字段，指令层也没有已注册的 " +
    "cost.pay 原语（effects/instructions/ 只有 effect.* 文件），费用计划与收费管线未接通（RIFT-89）。" +
    "effect.draw 本体已合入并单独执行；不近似实现（不把横置写成 effect.exhaust，也不把费用写成免费）。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        // 383.4.b：Targeting Effect；355.6/355.7：choose 指定对象即 Targeting。
        at: "became-target",
        filter: {
          event: "became-target",
          // "you choose" → 做出选择的玩家是能力控制者。
          player: "self",
          // "a friendly unit" → 与控制者同阵营的单位（740.1.a）。
          target: { type: "unit", controller: "self" }
        }
      },
      // 383.3.a / 383.3.e.2：效果开头的 "you may" 是触发能力自身的执行决定。
      optional: true,
      body: [
        {
          id: "spirit-wheel.may-pay-and-draw",
          // 契约 3.9："可以……"包成 choice.optional，被选指令（付费 + 抽牌）在 body 里。
          op: "choice.optional",
          args: {
            prompt: {
              kind: "constant",
              value: "Pay :rb_energy_1: and exhaust Spirit Wheel to draw 1?"
            },
            body: {
              kind: "constant",
              value: [
                {
                  id: "spirit-wheel.pay",
                  // 383.3.b / 383.3.b.1：1 energy + Exhaust this 是基础费用、Finalize 支付；
                  // cost.pay 原语与费用管线接线见 judgeReason。
                  op: "cost.pay",
                  args: {
                    energy: { kind: "constant", value: 1 },
                    payments: { kind: "constant", value: [{ kind: "exhaust", object: "self" }] }
                  }
                },
                {
                  id: "spirit-wheel.draw-1",
                  linkedTo: "spirit-wheel.pay",
                  // 414.1 / 414.3：抽牌者隐含为能力控制者（190.6.d）。
                  op: "effect.draw",
                  args: { amount: { kind: "constant", value: 1 } }
                }
              ]
            }
          }
        }
      ]
    }
  ],
  sourceText:
    "When you choose a friendly unit, you may pay :rb_energy_1: and exhaust this to draw 1."
} satisfies CardProgram;

import type { CardProgram } from "../../ir/index.js";

/**
 * Mistfall (ogn-152-298) — Gear, 3 Energy, Body.
 *
 * "When you buff a friendly unit, you may pay :rb_rune_body: and exhaust this
 *  to ready it."
 *
 * CR v1.5 anchors:
 * - 383 / 427.1: "When you buff …" subscribes to the buff-added timing point;
 *   "you" is the ability controller (190.6.d), and "a friendly unit" is the
 *   unit that received the Buff (payload object), not a fresh target.
 * - 383.3.a.3: the "you may" appears inside the Effect, so the choice is made
 *   when the triggered ability resolves; it is encoded with choice.optional
 *   around the paid instructions (contract 3.9), not as a linked choice.
 * - 430 / 415: "pay :rb_rune_body:" spends one Body Power from the Rune Pool,
 *   "exhaust this" is a cost on the source Gear (415.4/415.5).
 * - 416: "ready it" readies the unit that was buffed.
 *
 * status 判定（2026-10-17 复核）：judge-required。四处已实测的当前缺口：
 * 1. events/trigger-spec.ts 的 EVENT_PATTERN_TYPES 闭集没有 buff-added，CardProgram 触发注册
 *    （pipeline.registerTrigger → assertTriggerSpec）以 invalid-event-type 失败（实测）。
 * 2. “支付 1 Body Power 并横置此牌” 是触发结算期的费用，但 TriggeredAbility 没有 cost 字段
 *    （ir/types.ts），而 cost.pay 只消费已锁定的计划：实测把 `payments: [{ kind: "exhaust", object: "self" }]`
 *    交给原语会抛 "cost.pay requires a valid, payable finalized cost plan"，生产 Finalize 也不会给触发
 *    装配这笔附加费用。
 * 3. 「ready it」的 it 必须绑定 buff-added 事件里的被 Buff 单位，契约 3.6 的 ObjectSelector 没有
 *    触发事件对象选择器；当前 IR 用一个新的 TargetSpec 表达，但 chain/engine.ts 的
 *    assertFinalizationSurface 对嵌套 targets 抛 "Nested/repeated targets require an interpreter
 *    target-selection lifecycle adapter"（实测），触发体的目标无法经 Finalize 锁定。
 * 4. 参考内核与生产 interpreter 都不提供“事件对象”取值，golden 只能真实执行 ready 半段。
 * 依赖：buff-added 事件词表、触发费用装配与事件对象选择器。不近似实现。
 */
const mistfall = {
  canonicalCardId: "card.hash-83ac5caa691e1d4ec728f3caba4e472ea1ca03749ff89db2ca5f1af82cf49020",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "四处已实测的当前缺口：（1）events/trigger-spec.ts 的 EVENT_PATTERN_TYPES 闭集没有 buff-added，" +
    "CardProgram 触发注册（pipeline.registerTrigger → assertTriggerSpec）以 invalid-event-type 失败。" +
    "（2）“支付 1 Body Power 并横置此牌” 是触发结算期的费用，但 TriggeredAbility 没有 cost 字段（ir/types.ts），" +
    "cost.pay 只消费已锁定的计划：实测把 payments: [{ kind: \"exhaust\", object: \"self\" }] 交给原语抛 " +
    "“cost.pay requires a valid, payable finalized cost plan”，生产 Finalize 也不给触发装配附加费用。" +
    "（3）「ready it」的 it 必须绑定 buff-added 事件里的被 Buff 单位，契约 3.6 的 ObjectSelector 没有触发事件" +
    "对象选择器；当前 IR 用新的 TargetSpec 表达，但 chain/engine.ts 的 assertFinalizationSurface 对嵌套 targets 抛 " +
    "“Nested/repeated targets require an interpreter target-selection lifecycle adapter”（实测），触发体目标" +
    "无法经 Finalize 锁定。（4）参考内核与生产 interpreter 都不提供“事件对象”取值，golden 只真实执行 ready 半段。" +
    "buff-added 时点与 effect.ready 原语已合入；整卡仍不可执行。不近似实现。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "buff-added",
        filter: {
          event: "buff-added",
          object: { type: "unit" },
          player: "self"
        }
      },
      optional: false,
      body: [
        {
          id: "mistfall.may-pay",
          op: "choice.optional",
          args: {
            prompt: { kind: "constant", value: "Pay 1 Body Power and exhaust Mistfall to ready it?" },
            body: {
              kind: "constant",
              value: [
                {
                  id: "mistfall.pay-cost",
                  op: "cost.pay",
                  args: {
                    power: { kind: "constant", value: ["Body"] },
                    payments: {
                      kind: "constant",
                      value: [{ kind: "exhaust", object: "self" }]
                    }
                  }
                },
                {
                  id: "mistfall.ready-buffed-unit",
                  op: "effect.ready",
                  linkedTo: "mistfall.pay-cost",
                  args: {
                    objects: { kind: "constant", value: { kind: "target", id: "mistfall.buffed-unit" } }
                  },
                  targets: [
                    {
                      id: "mistfall.buffed-unit",
                      filter: { type: "unit", controller: "self" },
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
  ],
  sourceText: "When you buff a friendly unit, you may pay :rb_rune_body: and exhaust this to ready it."
} satisfies CardProgram;

export default mistfall;

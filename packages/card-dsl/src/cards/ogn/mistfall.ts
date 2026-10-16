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
 */
const mistfall = {
  canonicalCardId: "card.hash-83ac5caa691e1d4ec728f3caba4e472ea1ca03749ff89db2ca5f1af82cf49020",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "触发能力的前置费用「支付 1 Body Power 并横置此牌」在契约 3.1 的 TriggeredAbility 上没有 cost 字段，" +
    "cost.pay 也不是已注册指令原语（费用计划由 chain Finalize 生成，依赖 RIFT-89/90）；" +
    "「ready it」的 it 必须绑定 buff-added 事件中的被 Buff 单位，契约 3.6 的 ObjectSelector 没有事件对象选择器" +
    "（依赖 RIFT-21 触发 payload 绑定或契约补充）。buff-added 时点与 effect.ready 原语虽已合入，但整卡不可执行；不近似实现。",
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

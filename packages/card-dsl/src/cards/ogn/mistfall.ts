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
    "仍有三处缺口，不近似实现：（1）events/trigger-spec.ts 的 EventPattern 类型闭集没有 buff-added，" +
    "因此 CardProgram 触发注册会在校验阶段失败；（2）cost.pay 的 payments 数组只能消费已结算的直接支付计划，" +
    "不能从“支付 1 Body Power 并横置此牌”生成触发费用；（3）「ready it」的 it 必须绑定 buff-added 事件中的被 Buff 单位，" +
    "契约 3.6 的 ObjectSelector 没有触发事件对象选择器。buff-added 时点与 effect.ready 原语已合入，" +
    "golden 真实执行 ready 半段；整卡仍不可执行。",
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

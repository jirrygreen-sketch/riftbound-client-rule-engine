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
 * status = judge-required（2026-10-18 复核；383.3.b 的前导基础费用仍无法在 Finalize 收取）：
 * - 费用本体已改为已合入的可支付形状：cost.modify 锁定
 *   { kind: "activated", energy: 1, payments: [{ kind: "exhaust", object: "self" }] }
 *   计划，cost.pay 经 linked-value 收取（同 sfd/altar-of-memories）。解释器上实测真的扣
 *   1 Energy 并横置宿主（events = ["pay", "exhaust"]）。
 * - 仍缺生产链路径：(a) 契约 3.1 的 TriggeredAbility 没有费用字段，programs/triggers.ts
 *   也不从正文提取，TriggerRegistration.cost/mayAtFinalize 实测恒为 undefined，
 *   383.3.a/383.3.e.2 的 Finalize「you may」决定与 383.3.b.1 的付费门因此都不可执行；
 *   (b) chain/interpreter-adapter.ts 的字面量表不含 cost.modify，正文里的该指令在链上
 *   实测抛 TypeError("cost.modify id must be a non-empty string")，到不了 Resolve。
 * - 已可真实执行的部分：became-target 订阅、effect.draw 本体，以及 cost.modify/cost.pay
 *   对「1 energy + exhaust this」的真实收取（golden 均用生产代码执行）。
 */
export default {
  canonicalCardId: "card.hash-498c7e8ce2e20ef011de716db7cf2ff6e0f71a410cc40dace65553df8b0b2518",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「you may pay :rb_energy_1: and exhaust this」按 CR 383.3.b/383.3.b.1/404.1.b.1/415.4 是该触发能力的基础费用，" +
    "必须在 Finalize 支付；费用本体已改写为已合入的可支付形状（cost.modify 锁定 " +
    "{ kind: \"activated\", energy: 1, payments: [{ kind: \"exhaust\", object: \"self\" }] }，cost.pay 经 linked-value 收取，" +
    "解释器实测扣 1 Energy + 横置宿主），但生产链路径仍缺两段接线：" +
    "(a) 契约 3.1 的 TriggeredAbility 没有费用字段、programs/triggers.ts 也不从正文提取费用或 383.3.a/383.3.e.2 的 " +
    "Finalize「you may」决定，TriggerRegistration.cost/mayAtFinalize 实测恒为 undefined，" +
    "chain/engine.ts 只在 item.cost 存在时才调用 buildCostPlan 支付，383.3.b.1 的门不可执行；" +
    "(b) chain/interpreter-adapter.ts 的 primitive 字面量表不含 cost.modify，该指令在链上实测抛 " +
    "TypeError(\"cost.modify id must be a non-empty string (or supply source)\")，正文里的费用对到不了 Resolve。" +
    "已可真实执行并有 golden 实测：became-target 订阅（spec.at = became-target、target 过滤解析为 controller: self）、" +
    "effect.draw 本体、cost.modify/cost.pay 的真实收取与 415.4 的已横置拒付。" +
    "不近似实现（不把横置改写成结算期 effect.exhaust，也不把费用写成免费）。" +
    "依赖：TriggeredAbility 的基础费用字段 + programs/triggers.ts 的 cost/mayAtFinalize 提取，" +
    "以及 chain/interpreter-adapter.ts 对 cost.modify 的字面量化。",
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
                  id: "spirit-wheel.prepare-payment",
                  // 383.3.b / 383.3.b.1：1 energy + Exhaust this 是基础费用。cost.modify 先把可支付的
                  // 计划锁进 linked value（cost/plan-values.ts 支持 { kind: "exhaust", object: "self" }），
                  // 再由 cost.pay 收取；缺的是把这段前导费用提升到 Finalize（见 judgeReason）。
                  op: "cost.modify",
                  args: {
                    id: { kind: "constant", value: "spirit-wheel.prepare-payment" },
                    cost: {
                      kind: "constant",
                      value: {
                        kind: "activated",
                        energy: { kind: "constant", value: 1 },
                        payments: [{ kind: "exhaust", object: "self" }]
                      }
                    }
                  }
                },
                {
                  id: "spirit-wheel.pay",
                  op: "cost.pay",
                  linkedTo: "spirit-wheel.prepare-payment",
                  args: {
                    cost: {
                      kind: "linked-value",
                      instructionId: "spirit-wheel.prepare-payment",
                      key: "cost"
                    }
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

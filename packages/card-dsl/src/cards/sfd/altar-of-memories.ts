import type { CardProgram } from "../../ir/index.js";

/**
 * Altar of Memories (sfd-169-221) — Gear, 2 energy, Might null, Order, 无标签。
 *
 * sourceText（逐字取自 packages/card-data/data/deck-catalog.json sfd-169-221）：
 *   "When a friendly unit dies, you may exhaust me to draw 1, then put a card from your
 *    hand on the top or bottom of your Main Deck."
 *
 * 规则依据（CR v1.5）：
 * - 383.1 / 383.2.a："When a friendly unit dies" 是触发条件；429.1 规定被消灭是永久物从
 *   Board 进入 Trash，封闭时点对应 object-killed（events/timing-points.ts，ruleRefs
 *   429.1/429.2）。"friendly" = 与该能力控制者同控制者（740.1.a），事件物体用 ObjectFilter
 *   的 PlayerSelector "self"（引擎把它解析为"等于触发控制者"）。
 * - 383.3.a：效果开头的 "you may" 是触发能力自身的执行决定，因此 ability.optional = true；
 *   383.3.b / 383.3.b.1："exhaust me to draw 1" 紧跟在 "you may" 之后，是基础费用内的横置，
 *   必须在 Finalize 支付（415.4 / 415.5）。
 * - 契约 3.9："you may … then …" 是一个可选决定覆盖其后的指令，写成 choice.optional 并把
 *   被选指令包进 body（不用 choice + linkedTo）。"then" 是顺序词，不是结果绑定。
 * - 414.1 / 414.3："draw 1" 用 effect.draw，抽牌者缺省为能力控制者（190.6.d）。
 * - 108.7/414.1："a card from your hand" 是私有区域里的非目标选择（355.10.a 的
 *   "play a unit from your hand" 示例），因此是 pick 而不是 target。
 * - "on the top or bottom of your Main Deck" 用 effect.zone：把该手牌移到主牌库顶或底
 *   （ZoneDestination "deck-top"/"deck-bottom"），顶端/底端由结算期的目的地选择决定
 *   （effect.zone 的 choice 形式）。"your Main Deck" 是能力控制者的主牌库（375.1）。
 *
 * 当前复核：保持 judge-required；具体未接通路径见 judgeReason。
 */
export default {
  canonicalCardId: "card.hash-fae74af4b0507308396536f4f9d367af185a5d09b03c11aa0a1c4db55655778b",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "CR 383.3.b/383.3.b.1 把开头的 “you may exhaust me to draw 1” 视为该触发能力的基础费用，必须在 Finalize 支付（415.4/415.5/405.2）：" +
    "contract.ts 的 TriggeredAbility 没有 cost 字段，卡程序无法声明这条费用；programs/triggers.ts 生成的 TriggerRegistration 从不填 TriggerRegistration.cost，" +
    "链的 finalize 因此拿不到锁定计划（chain/engine.ts 只在 item.cost 存在时调用 buildCostPlan），而 body 里 cost.pay 的 payments 数组并不是它支持的锁定计划形状（已注册的 cost.pay 只接受 finalized 计划）。" +
    "缺触发费用的 Finalize 选择、可支付性检查与事务消费：既不能在 Resolve 才横置，也不能只凭 optional 被接受就免费抽牌。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "object-killed",
        filter: {
          event: "object-killed",
          // "a friendly unit"：与控制者同阵营的单位（740.1.a），"you" 由触发控制者解析。
          object: { type: "unit", controller: "self" }
        }
      },
      // 383.3.a：效果开头的 "you may" 是触发能力自身的执行决定。
      optional: true,
      body: [
        {
          id: "altar-of-memories.may-exhaust-and-draw",
          // 契约 3.9：一个可选决定覆盖其后的两条指令，包进 choice.optional 的 body。
          op: "choice.optional",
          args: {
            prompt: {
              kind: "constant",
              value: "Exhaust Altar of Memories to draw 1, then put a card from your hand on the top or bottom of your Main Deck?"
            },
            body: {
              kind: "constant",
              value: [
                {
                  id: "altar-of-memories.pay-exhaust",
                  // 383.3.b / 383.3.b.1：横置自身是基础费用，Finalize 支付；
                  // cost.pay 原语与费用管线接线见 judgeReason。
                  op: "cost.pay",
                  args: {
                    payments: { kind: "constant", value: [{ kind: "exhaust", object: "self" }] }
                  }
                },
                {
                  id: "altar-of-memories.draw-1",
                  linkedTo: "altar-of-memories.pay-exhaust",
                  // 414.1 / 414.3：抽牌者隐含为能力控制者（190.6.d）。
                  op: "effect.draw",
                  args: { amount: { kind: "constant", value: 1 } }
                },
                {
                  // "then put a card from your hand on the top or bottom of your Main
                  // Deck"："then" 是顺序词（不写 linkedTo）；手牌选择是非目标 pick
                  // （355.10.a），顶端/底端由 effect.zone 的结算期目的地选择决定。
                  id: "altar-of-memories.put-back",
                  op: "effect.zone",
                  args: {
                    pick: { kind: "constant", value: "altar-of-memories.hand-card" },
                    choice: {
                      kind: "constant",
                      value: {
                        id: "altar-of-memories.destination",
                        options: ["deck-top", "deck-bottom"],
                        prompt:
                          "Put that card on the top or the bottom of your Main Deck?"
                      }
                    }
                  },
                  picks: [
                    {
                      id: "altar-of-memories.hand-card",
                      // 手牌是私有区域：非目标选择（355.10.a）。
                      options: ["card-in-controller-hand"],
                      filter: { zone: "hand", owner: "controller" },
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
  sourceText:
    "When a friendly unit dies, you may exhaust me to draw 1, then put a card from your hand on the top or bottom of your Main Deck."
} satisfies CardProgram;

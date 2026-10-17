import type { CardProgram } from "../../ir/index.js";

/**
 * Void Burrower — sfd-187-221 (CR v1.5 383.3.a/b, 420.3, 425.3, 417.4).
 * Conquer emission and trigger registration exist. Ordered reveal picks now
 * use the merged zoneSlice pick source; the leading exhaust belongs to
 * Finalize and the selected-card play-cost plan still blocks execution.
 */
export default {
  canonicalCardId: "card.hash-289ad4d681c7cb59dd55bae00863be7516f68dff172a97e886f4ff7920625b0c",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "conquer 发射与 CardProgram 触发注册已存在；当前阻断是：(1) programs/triggers.ts 未把首个 you may 映射到 mayAtFinalize，也未把 leading exhaust 转成 TriggerRegistration.cost；383.3.a/b、404.1.b.1 要求 Finalize 决定并付费，不能结算期用 effect.exhaust 代替。(2) 有序牌库顶 picks 与链适配器 LITERAL_FIELDS 对 effect.reveal.pick 的解包已合入（链测试已锁定 pickPlans），仅剩 mayAtFinalize/cost 的生产接线。(3) effect.play 的印刷费用计划须由打出绑定提供，不能用免费测试内核的 play 证明已支付。(4) 同一 canonical 身份的 sfd-243-221 写作 You may banish one, then play it. Recycle the rest.，与本卡 sfd-187-221 的直接打出有 428.1/420.3 区域路径差异；docs/plans/survey/unclassified-rad-sfd.md 第 5 条仍缺勘误或按印刷号裁定依据。保持 judge-required。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "conquer",
        // The closed EventPattern spelling for conquering is "conquered"
        // (events/trigger-spec.ts EVENT_PATTERN_TYPES; pipeline-match aliases it to
        // the `conquer` timing point). "you conquer" = this ability's controller
        // performed the action (383.4.c.2.b / 190.6.d).
        filter: { event: "conquered", player: "self" }
      },
      // 383.3.a: the leading "you may" is this ability's own Finalize decision.
      optional: true,
      body: [
        {
          id: "void-burrower.exhaust-self",
          // 383.3.b / 355.10.c.1: "exhaust me" is the trigger's base cost, not a
          // target; declared in printed position as a non-target choose anchored to
          // the source. The real Finalize charging is judgeReason 2.
          op: "effect.exhaust",
          args: {
            choose: {
              kind: "constant",
              value: { id: "void-burrower.exhaust-self", filter: { object: "self" } }
            }
          }
        },
        {
          id: "void-burrower.reveal-top-two",
          // 425.1 / 425.3.a: reveal the ordered top two of the Main Deck; they stay
          // in the deck (425.1.a.2). Only picks can carry real deck order.
          op: "effect.reveal",
          args: {
            pick: { kind: "constant", value: "void-burrower.top-two" }
          },
          picks: [
            {
              id: "void-burrower.top-two",
              // Ordered Main Deck slice (contract 3.6 / CR 425.3.a): the
              // The merged chain Finalize locks this source from
              // ctx.zoneSlice(controller, "deck", "top", 2); the query
              // vocabulary cannot express deck order.
              options: [],
              ordered: true,
              selection: "all",
              zoneSlice: { zone: "deck", from: "top", count: { kind: "constant", value: 2 } }
            }
          ]
        },
        {
          id: "void-burrower.may-play-one",
          // 383.3.a.3 + contract 3.9: the later "You may" is one choice.optional
          // whose body holds the chosen instruction.
          op: "choice.optional",
          args: {
            prompt: { kind: "constant", value: "Play one of the revealed cards?" },
            body: {
              kind: "constant",
              value: [
                {
                  id: "void-burrower.play-one",
                  // 420.3.a / 420.3.b / 420.3.c: a Limited Play Effect that reads
                  // the revealed cards as a resolution-time non-target pick and
                  // leaves the card's own cost to the normal Play procedure.
                  op: "effect.play",
                  args: {
                    pick: { kind: "constant", value: "void-burrower.play-one" },
                    choice: {
                      kind: "constant",
                      value: { id: "void-burrower.play-one-choice", min: 1, max: 1 }
                    }
                  },
                  picks: [
                    {
                      id: "void-burrower.play-one",
                      options: [
                        {
                          kind: "linked-value",
                          instructionId: "void-burrower.reveal-top-two",
                          key: "revealed"
                        }
                      ],
                      min: 1,
                      max: 1,
                      selection: "one"
                    }
                  ]
                }
              ]
            }
          }
        },
        {
          id: "void-burrower.recycle-rest",
          // 417.1.a / 417.4: recycle the remaining revealed cards to their owner's
          // Main Deck bottom. The played card's deck identity is invalid after it
          // leaves the deck (124), so the merged mechanics drop it and the rest is
          // genuinely "the rest". Not linked to the play: 359.3.e.11 keeps "Then
          // recycle the rest." resolving when the optional play is declined.
          op: "effect.recycle",
          args: {
            objects: {
              kind: "linked-value",
              instructionId: "void-burrower.reveal-top-two",
              key: "revealed"
            }
          }
        }
      ]
    }
  ],
  sourceText:
    "When you conquer, you may exhaust me to reveal the top 2 cards of your Main Deck. " +
    "You may play one. Then recycle the rest."
} satisfies CardProgram;

import type { CardProgram } from "../../ir/index.js";

/**
 * Void Rush (sfd-188-221) — Spell, 2 energy + 1 Fury/Order power, Fury/Order,
 * tags Rek'Sai/Signature.
 *
 * Printed text:
 *   Reveal the top 2 cards of your Main Deck. You may play one of them,
 *   reducing its cost by :rb_energy_2:. Draw any you did not play this way.
 *
 * Modeling notes (Core Rules v1.5):
 * - "Reveal the top 2 cards of your Main Deck" is 425.3 ("Reveal 2 cards from
 *   the top of your Main Deck"); the cards remain in the Main Deck
 *   (425.1.a.2). The ordered deck-top slice must come from an ordered pick:
 *   effect.reveal's own zone+count path throws for any non-hand subset because
 *   query order is not deck order, and 432.1.c's "as much as possible" rule
 *   means an under-full deck still reveals what is there.
 * - "You may play one of them, reducing its cost by 2" is one optional
 *   decision (contract 3.9), so the card choice and the play live inside the
 *   choice body. The reduced cost has to arrive as an already-finalized cost
 *   plan: effect.play refuses to derive printed costs, and no merged op
 *   applies the -2 (cost.modify is not in the frozen primitive set), so the
 *   play cannot be authorized today. The card carries a documented
 *   cost-plan placeholder naming the reduction instead of playing at full
 *   price, which would silently be a different card.
 * - "Draw any you did not play this way" moves the remaining revealed cards
 *   to hand (effect.zone with a non-target pick, 355.10.e: the cards are not
 *   targeted). Which cards remain is decided by what actually happened to the
 *   play, which needs the result-binding support (condition.result) that is
 *   not merged either.
 *
 * Status: judge-required. The reveal and the optional/linked structure are
 * described; the reduced-cost play and the "did not play this way" set
 * difference are missing merged support and are not approximated.
 */
const voidRush = {
  canonicalCardId: "card.hash-cd92b45de0981074325a5119213251cd97706ab04339f5fe7339e69c8761258a",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「You may play one of them, reducing its cost by :rb_energy_2:」缺减费与费用计划支持：CR v1.5 366.2 的印刷费用改写需要 cost.modify，" +
    "并由费用系统生成带改写费用的 FinalizedCostPlan（effect.play 明确不自行推导印刷费用）；当前两者都未合入，故不近似实现（不以全价打出代替）。" +
    "「Draw any you did not play this way」中「未被以此法打出」的集合差需要 359.3.e.14 的结果绑定（condition.result 未注册）。" +
    "「Reveal the top 2 cards of your Main Deck」需按 432.1.c 尽可能展示，且 effect.reveal 要求牌库顶有序子集由上游 pick 提供（query 顺序不代表牌库顺序）。" +
    "依赖：cost.modify / 费用计划（RIFT-89 批次）、结果绑定与牌库顶有序选择。",
  sourceText:
    "Reveal the top 2 cards of your Main Deck. You may play one of them, reducing its cost by :rb_energy_2:. Draw any you did not play this way.",
  abilities: [
    {
      kind: "play",
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 2 },
        power: { kind: "constant", value: 1 }
      },
      body: [
        {
          // "Reveal the top 2 cards of your Main Deck" — the ordered deck-top
          // slice is an upstream pick (effect.reveal rejects unordered deck
          // subsets; 432.1.c keeps the reveal legal with fewer cards).
          id: "void-rush.reveal",
          op: "effect.reveal",
          args: { pick: { kind: "constant", value: "void-rush.top-two" } },
          picks: [
            {
              id: "void-rush.top-two",
              options: ["deck-top-two-of-controller"],
              min: 0,
              max: 2,
              selection: "up-to"
            }
          ]
        },
        {
          // "You may play one of them, reducing its cost by 2" — one optional
          // decision (contract 3.9) whose body holds the play.
          id: "void-rush.may-play",
          op: "choice.optional",
          linkedTo: "void-rush.reveal",
          args: {
            prompt: { kind: "constant", value: "Play one of the revealed cards for 2 energy less?" },
            body: {
              kind: "constant",
              value: [
                {
                  id: "void-rush.play",
                  op: "effect.play",
                  args: {
                    pick: { kind: "constant", value: "void-rush.played-card" },
                    // Placeholder for the printed cost minus 2 energy; the
                    // real plan must be materialized by cost.modify and the
                    // cost system (see judgeReason).
                    cost: {
                      kind: "constant",
                      value: {
                        kind: "cost-plan-request",
                        from: "printed",
                        reduction: { energy: 2 }
                      }
                    }
                  },
                  picks: [
                    {
                      id: "void-rush.played-card",
                      options: [{ kind: "linked-value", instructionId: "void-rush.reveal", key: "revealed" }],
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
          // "Draw any you did not play this way": the remaining revealed
          // cards move to hand. Non-target pick (355.10.e); the set difference
          // against what was actually played needs result binding.
          id: "void-rush.draw-rest",
          op: "effect.zone",
          linkedTo: "void-rush.may-play",
          args: {
            pick: { kind: "constant", value: "void-rush.remaining" },
            to: { kind: "constant", value: "hand" },
            amount: { kind: "constant", value: 2 }
          },
          picks: [
            {
              id: "void-rush.remaining",
              options: [{ kind: "linked-value", instructionId: "void-rush.reveal", key: "revealed" }],
              min: 0,
              max: 2,
              selection: "up-to"
            }
          ]
        }
      ]
    }
  ]
} satisfies CardProgram;

export default voidRush;

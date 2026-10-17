import type { CardProgram } from "../../ir/index.js";

/**
 * Void Rush — sfd-188-221 (CR v1.5 425.3, 356.4, 420.3, 414.1).
 * Ordinary cost modifiers exist. Selected-card plan handoff, ordered picks and
 * drawing the actual unplayed revealed objects remain blocked. The pending
 * move-to-hand declaration below does not implement Draw and must not execute.
 */
const voidRush = {
  canonicalCardId: "card.hash-cd92b45de0981074325a5119213251cd97706ab04339f5fe7339e69c8761258a",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "(1) cost.modify 已支持普通 Energy 减费，但所选揭示牌的印刷 CostPlan、[2] 折扣到 effect.play/Finalize 的计划交接仍未绑定；当前 cost-plan-request 仅记录意图，不是可支付计划（356.4、420.3）。(2) 有序牌库顶 picks 依赖 RIFT-358，链适配器 LITERAL_FIELDS 仍未解包 effect.reveal.pick。(3) Draw any you did not play this way 必须对实际剩余揭示对象执行 Draw（414.1）；当前 draw-rest 的 effect.zone 只是不可执行草图，会产生 return-to-hand 而非 draw，effect.draw 的 pick 仅选抽牌者、不接受指定卡集合。需要已揭示对象集合的 Draw 接口；不能用固定抽 2、回手动作或不存在的 condition.result 近似。抽剩余牌独立于是否接受可选打出。",
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
              // The ordered deck-top two of the ability controller; the string is
              // the descriptive option id of the missing ordered-pick producer
              // (see judgeReason).
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
                    // real selected-card plan must reach the existing cost
                    // system and effect.play (see judgeReason).
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
          // Pending Draw intent (414.1): effect.zone cannot emit Draw events.
          // All actual remaining revealed refs must be drawn, even if play is
          // declined. This block stays unreachable while judge-required.
          id: "void-rush.draw-rest",
          op: "effect.zone",
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
              selection: "all"
            }
          ]
        }
      ]
    }
  ]
} satisfies CardProgram;

export default voidRush;

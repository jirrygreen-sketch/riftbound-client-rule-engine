import type { CardProgram } from "../../ir/index.js";

/**
 * Void Rush — sfd-188-221 (CR v1.5 425.3, 356.4, 420.3, 414.1).
 * Ordinary cost modifiers and the merged zoneSlice reveal source exist. The
 * selected-card plan handoff and drawing the actual unplayed revealed
 * objects remain blocked; the pending move-to-hand declaration below does
 * not implement Draw and must not execute.
 */
const voidRush = {
  canonicalCardId: "card.hash-cd92b45de0981074325a5119213251cd97706ab04339f5fe7339e69c8761258a",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "(1) 普通减费已合入：may-play 前置 cost.modify 真实冻结 [2] Energy 折扣计划（356.4），但所选揭示牌的印刷费无法进入该计划（cost.modify 只读 ctx.source 或显式 printed，无 linked 对象印刷费投影），且应付额在 plan.total，而 effect.play/链 Finalize 只消费扁平 FinalizedCostPlan（finalized/energy/power/xp），所选牌计划→Play 的交接仍缺（420.3）。(2) zoneSlice 有序 picks 与链适配器 LITERAL_FIELDS 对 effect.reveal.pick 的解包已由 RIFT-358 合入（链测试已锁定 pickPlans）；judge-required 程序仍不入生产注册表。(3) Draw any you did not play this way 必须对实际剩余揭示对象执行 Draw（414.1）；effect.draw 的 pick 仅选抽牌者、不接受指定卡集合，choice.optional 也只产 value:true 不回链所选引用，未打出集合无 exclude 产生方。不能用固定抽 2、回手动作或不存在的 condition.result 近似。抽剩余牌独立于是否接受可选打出。",
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
              // The ordered deck-top two of the ability controller (CR
              // 425.3.a): the merged RIFT-358 chain Finalize locks this
              // source; 432.1.c keeps an under-full deck legal.
              options: [],
              ordered: true,
              selection: "all",
              zoneSlice: { zone: "deck", from: "top", count: { kind: "constant", value: 2 } }
            }
          ]
        },
        {
          // "reducing its cost by 2" (CR 356.4): a real cost.modify that
          // freezes a genuine plan. Which card's printed cost the plan must
          // describe, and how the plan crosses into effect.play/Finalize,
          // remain the recorded gaps (see judgeReason).
          id: "void-rush.cost-plan",
          op: "cost.modify",
          args: {
            id: { kind: "constant", value: "void-rush.cost-plan" },
            modifier: {
              kind: "constant",
              value: {
                kind: "reduce",
                resource: "energy",
                amount: { kind: "constant", value: 2 },
                minimum: { kind: "constant", value: 0 }
              }
            }
          }
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
                    // The [2] discount is real (frozen upstream by
                    // void-rush.cost-plan, CR 356.4); binding the selected
                    // card's printed plan into it at Play/Finalize is still
                    // the recorded gap (see judgeReason).
                    cost: {
                      kind: "linked-value",
                      instructionId: "void-rush.cost-plan",
                      key: "cost"
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
              options: [],
              ordered: true,
              selection: "all",
              linked: { kind: "linked-value", instructionId: "void-rush.reveal", key: "revealed" }
            }
          ]
        }
      ]
    }
  ]
} satisfies CardProgram;

export default voidRush;

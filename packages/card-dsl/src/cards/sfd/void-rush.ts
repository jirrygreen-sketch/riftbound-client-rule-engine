import type { CardProgram } from "../../ir/index.js";

/**
 * Void Rush — sfd-188-221 (CR v1.5 425.3, 356.4, 420.3, 414.1).
 *
 * Status: judge-required (cards/README.md §2), re-verified 2026-10-18 against the
 * merged engine sources. Three measured gaps, none approximated:
 * - The adapter still cannot decode this card's cost.modify body.
 *   chain/interpreter-adapter.ts LITERAL_FIELDS has no cost.modify entry, so the
 *   card's constant-wrapped modifier reaches the primitive's schema; measured
 *   failures are "Invalid cost.modify modifier argument: value" as authored and
 *   "cost.modify id must be a non-empty string (or supply source)" when only the
 *   selector is unwrapped by hand. The chain adapter is the measured missing
 *   layer; a hand-authored rewrap is not production behavior.
 * - Even after that decoding, the selected revealed card's printed cost cannot
 *   enter the plan: cost.modify reads ctx.source or an explicit `printed`
 *   projection only, so the frozen [2] discount describes the wrong card, and
 *   effect.play only consumes a FinalizedCostPlan descriptor. The real
 *   selected-card plan handoff into EffectIR play (420.3) is missing.
 * - "Draw any you did not play this way" (414.1) still has only a pending
 *   effect.zone move-to-hand declaration: effect.zone is not Draw, effect.draw
 *   accepts only a chooser (no explicit card set), and choice.optional returns
 *   the boolean only, so the unplayed revealed references cannot be addressed.
 */
const voidRush = {
  canonicalCardId: "card.hash-cd92b45de0981074325a5119213251cd97706ab04339f5fe7339e69c8761258a",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "(1) chain/interpreter-adapter.ts 仍无法解包本卡的 cost.modify：LITERAL_FIELDS 没有 cost.modify 项，实测原样 resolveChainBody 抛 \"cost.modify id must be a non-empty string (or supply source)\"，" +
    "手工只解包 id 后仍抛 \"Invalid cost.modify modifier argument: value\"；手工把 id 与 modifier 都解包才 freeze 出计划（356.4 的 [2] 减费计划），这不是生产链路行为，不能据此宣称已接通。(2) 即使补上适配解包，" +
    "所选揭示牌的印刷费仍无法进入计划：cost.modify 只读 ctx.source 或显式 printed 投影，没有 linked 对象印刷费投影；且 effect.play/链 Finalize 只消费扁平 FinalizedCostPlan（finalized/energy/power/xp），所选牌计划→Play 的交接（420.3）仍缺；" +
    "已合入且实测可用的部分是有序 zoneSlice picks 与链适配器对 effect.reveal.pick 的解包（Finalize 锁定 pickPlans），judge-required 程序仍不入生产注册表。(3) Draw any you did not play this way 仍无法执行（414.1）：effect.zone 只是移动、不是 Draw；effect.draw 的 pick 只选抽牌者，不接受指定卡集合；" +
    "choice.optional 只产 value:true，不回链所选引用，也未打出集合没有 exclude 产生方。不能用固定抽 2、回手动作或不存在的 condition.result 近似；抽剩余牌独立于是否接受可选打出。",
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
              // 425.3.a): the merged chain Finalize locks this
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

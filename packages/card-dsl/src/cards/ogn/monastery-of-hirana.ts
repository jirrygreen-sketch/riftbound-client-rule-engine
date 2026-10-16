import type { CardProgram } from "../../ir/index.js";

/**
 * Monastery of Hirana (ogn-282-298) — Battlefield, domainless.
 *
 * "When you conquer here, you may spend a buff to draw 1."
 *
 * CR v1.5 anchors:
 * - 383.4.c / 383.4.c.1 / 383.4.c.2.b: "When you conquer here …" is a Conquer
 *   Effect; Conquer Abilities that reference the player Conquering go on the
 *   chain when that player has Conquered (timing point "conquer", emitted by
 *   scoring/, rule refs 468.5.d / 471.1 / 473.2.a). 383.4.c.2.c: the ability
 *   still triggers if the point from Conquering was negated or replaced.
 * - 190.6.a / 190.6.d: "you" is this battlefield's Controller.
 * - 355.10.c / 355.10.c.1: the buff is part of the cost inside the instruction
 *   ("spend a buff to draw 1"), and the rule text uses this exact card as its
 *   example of a cost-within-an-instruction, so it is not a target: it is the
 *   non-target, private selection the buff payment needs.
 * - 702.2.b / 702.2.b.1 / 702.2.b.2 / 745.2: spending a buff removes one Buff
 *   counter from a unit the spending player controls, and a unit without a
 *   buff cannot be spent from; effect.buff mode "spend" submits the closed
 *   "spend-buff" action and enforces both restrictions.
 * - 414.3 / 414.1.a: the draw is one card to the ability controller from the
 *   top of their Main Deck.
 *
 * Status rationale (contract §3.1, cards README §2) and expected execution:
 * the card stays judge-required because the printed "you may spend a buff to
 * draw 1" needs a Finalize-locked payment (383.3.a/383.3.b: the "you may" is
 * the first part of the effect, so the decision is made while finalizing and
 * the cost within instructions is the ability's base cost) and the merged code
 * has neither a `cost.pay` instruction nor a CardProgram cost/trigger binding
 * (RIFT-261/RIFT-257). The merged `effect.buff` can only decline by negating
 * after the fact, so a bare choice.optional would still spend the buff
 * whenever the player accepts. The intended shape is the §3.9 optional
 * wrapper around spend-then-draw, with the draw gated on the spend's own
 * linked result ("spentCount") so the draw is not paid for with nothing. The
 * merged instructions are exercised end to end by the golden test; the
 * conquer/hold/score wave itself is already emitted by turn/flow's scoring
 * step (RIFT-270).
 */
export default {
  canonicalCardId: "card.hash-7616fe7692fc8b3e1bf7fcdbe41d93a4d08639e4c541b02a6378293a286e0550",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "仍缺两段可执行连线，不近似实现：(1) 383.3.a/383.3.b 的形状——「you may」是效果首个部分，决定发生在触发能力 finalization 时，「spend a buff」作为 " +
    "cost within instructions 取其 base cost（355.10.c.1 / 383.3.b.1 / 357）；TriggeredAbility 没有 cost 字段，cost.pay/cost.modify 仍未注册" +
    "（instructions/ 下没有 cost.* 文件，RIFT-261），费用无法在 Finalize 锁定；合并的 effect.buff 只能在结算后报 skipped，" +
    "裸 choice.optional 会在玩家接受时必然花掉 buff。(2) CardProgram 触发/费用绑定（RIFT-257）：没有任何已合入路径把本卡的 triggered 能力" +
    "注册到 conquer 时点（conquer/hold/score 一波已由 turn/flow 的计分步骤原子发出，RIFT-270），也没有把 optional 标记映射成 finalize 决定；" +
    "触发 filter 还需要绑定面把 IR 形状翻译进封闭词汇与载荷：event 从卡面拼写转为 EventPattern 的 \"conquered\"（pipeline-match 的 EVENT_NAMES），" +
    "here 占位绑定为 scoring 载荷的 details.battlefieldId 等于注册源战场。" +
    "其余（702.2.b.1/.2 的 spend-buff 限制、spentCount 门控的 effect.draw 414.3）均已合入并由 golden 真实执行。",
  sourceText: "When you conquer here, you may spend a buff to draw 1.",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "conquer",
        filter: { event: "conquer", here: true, player: "controller" }
      },
      optional: true,
      body: [
        {
          // §3.9 shape for the printed "you may …": the accept decision wraps
          // the instructions it selects, instead of linking a later choice.
          id: "monastery-of-hirana.opt-in",
          op: "choice.optional",
          args: {
            prompt: { kind: "constant", value: "Spend a buff to draw 1?" },
            body: {
              kind: "constant",
              value: [
                {
                  // "spend a buff": non-target selection (355.10.c), one buff
                  // counter off a unit the ability's controller controls
                  // (702.2.b.1/.2). effect.buff records the actual result in
                  // the linked "spent"/"spentCount" values.
                  id: "monastery-of-hirana.spend-buff",
                  op: "effect.buff",
                  args: {
                    mode: { kind: "constant", value: "spend" },
                    target: { kind: "constant", value: "buff-holder" }
                  },
                  targets: [
                    {
                      id: "buff-holder",
                      filter: { type: "unit", zone: "board", controller: "controller" },
                      min: 1,
                      max: 1,
                      selection: "one"
                    }
                  ]
                },
                {
                  // "to draw 1": only after a buff was actually spent.
                  id: "monastery-of-hirana.draw",
                  op: "effect.draw",
                  args: { amount: { kind: "constant", value: 1 } },
                  condition: {
                    kind: "compare",
                    left: {
                      kind: "linked-value",
                      instructionId: "monastery-of-hirana.spend-buff",
                      key: "spentCount"
                    },
                    operator: "gte",
                    right: { kind: "constant", value: 1 }
                  }
                }
              ]
            }
          }
        }
      ]
    }
  ]
} satisfies CardProgram;

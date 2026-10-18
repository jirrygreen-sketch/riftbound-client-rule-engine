import type { CardProgram } from "../../ir/index.js";

/**
 * Forgotten Library (unl-211-219) — Battlefield, Colorless.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, unl-211-219, verbatim):
 *   "While you control this battlefield, when you play a spell, if you spent
 *    :rb_energy_4: or more, [Predict]. (Look at the top card of your Main Deck.
 *    You may recycle it.)"
 *
 * CR v1.5 anchors:
 * - 383.4.a / 383.4.a.4: "when you play a spell" is a Triggered Ability
 *   subscribed to the card-played timing point (359/407) whose event object is
 *   the spell the controller played; it is not a Play Effect.
 * - 190.6.a / 190.6.d: a Battlefield's abilities belong to its controller and
 *   "you" in them is that controller, which is what the printed "While you
 *   control this battlefield" window describes.
 * - 383.2.a.1: "if you spent [4] or more" immediately follows the trigger
 *   condition, so it is part of the Trigger Condition, evaluated when the
 *   condition is fulfilled. It needs the Energy actually paid to finalize the
 *   spell that was just played.
 * - 437.1 / 437.3 / 437.3.a / 437.4: Predicting means looking at the top card
 *   of the Main Deck and choosing whether to Recycle it; "[Predict]" without a
 *   value predicts 1 card, and too few cards predict as many as possible
 *   without Burn Out. The parenthetical reminder adds no ability.
 *
 * Executable shape (merged dependencies): the Predict body is authored in the
 * production interpreter form, not a placeholder. The symbolic "you"/"your"
 * selectors are bound at resolution with the merged condition.value native
 * instruction (359.3.f.1 referents are read at execution time; production
 * precedent sfd/called-shot binds this controller the same way). The ordered
 * "top card of your Main Deck" source is declared with the merged contract 3.6
 * zoneSlice pick (RIFT-358): the chain Finalize locks the top slice in real
 * deck order before resolution (chain/picks/plan.ts + chain/engine.ts
 * finalizeOrderedPickPlans), effect.inspect's "top" scope consumes the locked
 * ordered picksSpecId, and the private 0..1 recycle choice feeds
 * effect.recycle through the instruction link (417.1.b/417.4). The golden test
 * executes this body through the real interpreter adapter and the real
 * ChainEngine Finalize/AwaitChoice lifecycle, including the short-deck case.
 *
 * Status (packages/card-dsl/src/cards/README.md §2): judge-required. The whole
 * printed ability still cannot fire as one path: the trigger condition
 * "if you spent [4] or more" has no evaluable form — the frozen Expr/Condition
 * vocabulary reads object characteristics, linked values and object counts
 * only, and ResolveContext exposes no finalized-cost receipt for the spell that
 * was just played (383.2.a.1 cost-receipt reading; same gap unl-181-219
 * Virtuoso records; the merged cost.pay/cost.modify primitives produce
 * receipts, but no Condition reads a paid amount yet). The condition subject
 * below records that intent as a documented placeholder shape; it is never an
 * approximation of an amount. Trigger registration itself is no longer a gap:
 * programs/triggers.ts and card-played/beginning timing emissions are merged.
 *
 * Dependency: the finalized-cost receipt vocabulary (RIFT-89 follow-up).
 * Nothing is approximated.
 */
export default {
  canonicalCardId:
    "card.hash-0c84a15b23d289310ee132b8937d22231ed0dab9f0fc4a5bdbd529b58be62c3a",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "单一缺口（已按合入依赖复核）：「if you spent :rb_energy_4: or more」紧跟触发条件，" +
    "按 383.2.a.1 属于触发条件；但合并 IR 的 Expr/Condition 只能读对象特征、链接值与对象计数，" +
    "契约 3.6 的 ResolveContext 没有已定案费用回执入口，读不到「为刚打出的法术实际支付多少能量」" +
    "（依赖 RIFT-89 后续的费用回执读取词汇：cost.pay/cost.modify 原语已合并，但 Condition 仍没有读取已支付金额的形态；" +
    "同 unl-181-219 Virtuoso 的缺口；程序里的 count subject 是记录形状的占位）。" +
    "Predict 本体已按生产解释器形态真实执行：condition.value 在结算期读出「you/your」符号引用" +
    "（359.3.f.1；sfd/called-shot 绑定控制者同型），有序 zoneSlice pick 由链 Finalize 按牌库真实顺序锁定" +
    "（RIFT-358 已合入），effect.inspect top + 0..1 私有选择 + effect.recycle 走真实 ChainEngine 链路" +
    "（437.1/417.1.b），金测试含空牌库预测尽可能多的用例。触发注册（programs/triggers.ts + card-played 时点）" +
    "也已合入，不再是缺口。不近似实现。",
  sourceText:
    "While you control this battlefield, when you play a spell, if you spent :rb_energy_4: or more, [Predict]. " +
    "(Look at the top card of your Main Deck. You may recycle it.)",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "card-played",
        filter: {
          event: "card-played",
          // "you play a spell": the event object is the spell the ability's
          // controller played (383.4.a.4, 355.9).
          object: { type: "spell", controller: "self" }
        },
        // 383.2.a.1: "if you spent [4] or more" is part of the Trigger
        // Condition. The merged IR has no finalized-cost receipt dimension, so
        // the subject name records the intent (see judgeReason); it is not an
        // amount that could be read today.
        condition: {
          kind: "compare",
          left: {
            kind: "count",
            subject: "energy-spent-on-the-played-spell",
            filter: { player: "controller" }
          },
          operator: "gte",
          right: { kind: "constant", value: 4 }
        }
      },
      optional: false,
      body: [
        {
          // 359.3.f.1: "you"/"your" referents are read from the ability
          // controller at execution time; the merged condition.value native
          // instruction binds the controller as a linked value so no runtime
          // ObjectRef is written into static IR (sfd/called-shot precedent).
          id: "forgotten-library.bind-controller",
          op: "condition.value",
          args: {
            value: {
              kind: "object-property",
              object: "source",
              property: "controller"
            },
            key: { kind: "constant", value: "controller" }
          }
        },
        {
          // 437.1/437.3.a: look at the top card of the Main Deck and choose
          // 0..1 of the seen cards to recycle. "your Main Deck" is the
          // Battlefield controller's deck (190.6.d); the merged condition.value
          // link resolves the symbolic viewer at resolution.
          id: "forgotten-library.predict-look",
          op: "effect.inspect",
          linkedTo: "forgotten-library.bind-controller",
          args: {
            player: {
              kind: "linked-value",
              instructionId: "forgotten-library.bind-controller",
              key: "controller"
            },
            zone: { kind: "constant", value: "deck" },
            scope: { kind: "constant", value: "top" },
            amount: { kind: "constant", value: 1 },
            picksSpecId: { kind: "constant", value: "forgotten-library.predict-top-1" },
            choose: { kind: "constant", value: true },
            chooseCount: { kind: "constant", value: { min: 0, max: 1 } },
            choiceId: { kind: "constant", value: "forgotten-library.predict" },
            pickedKey: { kind: "constant", value: "predict-looked-at" },
            choosePicksKey: { kind: "constant", value: "predict-recycle" }
          },
          // 437.3.a's ordered deck-top read is the contract 3.6 zoneSlice
          // source: Finalize locks the top card in real deck order (RIFT-358)
          // and the link keeps it scoped to this instruction sequence.
          picks: [
            {
              id: "forgotten-library.predict-top-1",
              options: [],
              ordered: true,
              selection: "all",
              zoneSlice: {
                zone: "deck",
                from: "top",
                count: { kind: "constant", value: 1 }
              }
            }
          ]
        },
        {
          // 417.1.b/417.4: recycling the chosen card puts it on the bottom of
          // its owner's Main Deck; choosing none is an executed no-op. The
          // decision follows the look (437.1), so the instruction is linked.
          id: "forgotten-library.predict-recycle",
          op: "effect.recycle",
          linkedTo: "forgotten-library.predict-look",
          args: {
            objects: {
              kind: "linked",
              instructionId: "forgotten-library.predict-look",
              key: "predict-recycle"
            }
          }
        }
      ]
    }
  ]
} satisfies CardProgram;

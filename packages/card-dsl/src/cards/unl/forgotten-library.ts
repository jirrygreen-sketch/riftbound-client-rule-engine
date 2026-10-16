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
 * Status (packages/card-dsl/src/cards/README.md §2): judge-required. The
 * Predict body (inspect → recycle) uses only merged primitives and the golden
 * test executes it through the real interpreter with the viewer and the
 * ordered deck-top block bound, but the card cannot execute as printed:
 * 1. the trigger condition "if you spent [4] or more" has no evaluable path —
 *    the frozen Expr/Condition can read object characteristics, linked values
 *    and object counts only, and ResolveContext exposes no finalized-cost
 *    receipt, so the Energy paid for the just-played spell cannot be read
 *    (same gap unl-181-219 Virtuoso records; the `count` subject below is a
 *    documented placeholder shape, never an approximation of an amount);
 * 2. "[Predict]" reads the top card of the Main Deck: effect.inspect's "top"
 *    scope requires an upstream ordered picksSpecId and negates with
 *    negated/impossible without one, and the merged chain Finalize only locks
 *    instruction TargetSpecs — there is no ordered-zone pick lifecycle (the
 *    same production gap ogn/stacked-deck records);
 * 3. effect.inspect's argsSchema still validates object-property's `object` as
 *    a zone-bound ObjectRef instead of the contract 3.6 selector used below
 *    (the RIFT-102 follow-up ven/apprentice-mage records), so the symbolic
 *    "your Main Deck" binding is not executable as written either;
 * 4. no merged subscriber turns a CardProgram's triggered ability into a
 *    TriggerRegistration, so 190.6's Battlefield-controller resolution and the
 *    "While you control this battlefield" window have no producer.
 * Dependencies: RIFT-89 (finalized cost receipt), the ordered zone-pick
 * lifecycle that effect.inspect's contract already names, and RIFT-33 /
 * contract §7.2 batch 5 trigger registration. Nothing is approximated.
 */
export default {
  canonicalCardId:
    "card.hash-0c84a15b23d289310ee132b8937d22231ed0dab9f0fc4a5bdbd529b58be62c3a",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口，均不近似实现：(1)「if you spent :rb_energy_4: or more」紧跟触发条件，按 383.2.a.1 属于触发条件，" +
    "但合并 IR 的 Expr/Condition 只能读对象特征、链接值与对象计数（count 只数对象、不读金额），" +
    "契约 3.6 的 ResolveContext 也没有 finalized 费用回执入口，读不到「为刚打出的法术实际支付多少能量」" +
    "（依赖 RIFT-89 费用计划回执；同 unl-181-219 Virtuoso 的缺口，程序里的 count subject 是记录形状的占位）。" +
    "(2)「[Predict]」要看牌库顶：effect.inspect 的 scope \"top\" 必须由上游提供有序 picksSpecId，" +
    "缺有序来源时该原语按自身契约 negated/impossible；已合入的链 Finalize 只锁定 instruction.targets 的 TargetSpec" +
    "（chain/engine.ts），没有有序区域 pick 的锁定/生命周期（同 ogn/stacked-deck 记录的生产缺口）。" +
    "(3) effect.inspect 的 argsSchema 仍要求 object-property 的 object 是运行时 ObjectRef，" +
    "未同步契约 3.6 的符号选择器（RIFT-102 的校验器收口；同 ven/apprentice-mage 记录），故「your Main Deck」的符号绑定同样不可直接执行。" +
    "(4) 没有任何已合入订阅方把 CardProgram 的 triggered ability 注册成 TriggerRegistration，" +
    "190.6 的战场能力控制者解析与「While you control this battlefield」窗口没有生产者" +
    "（依赖 RIFT-33 触发注册 / RIFT-120，契约 §7.2 批 5）。" +
    "Predict 的 inspect → recycle 本体已用参考内核按绑定后的观看者与有序牌库顶真实执行；不近似实现。",
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
          // 437.1/437.3.a: look at the top card of the Main Deck and choose
          // 0..1 of the seen cards to recycle. "your Main Deck" is the
          // Battlefield controller's deck (190.6.d); the selector keeps
          // "source" so it still resolves after the spell changes zones.
          id: "forgotten-library.predict-look",
          op: "effect.inspect",
          args: {
            player: { kind: "object-property", object: "source", property: "controller" },
            zone: { kind: "constant", value: "deck" },
            scope: { kind: "constant", value: "top" },
            // The ordered deck-top block the caller must bind (contract 3.6
            // zoneSlice order; effect.inspect never derives order from query).
            picksSpecId: { kind: "constant", value: "forgotten-library.predict-top-1" },
            amount: { kind: "constant", value: 1 },
            choose: { kind: "constant", value: true },
            chooseCount: { kind: "constant", value: { min: 0, max: 1 } },
            choiceId: { kind: "constant", value: "forgotten-library.predict" },
            pickedKey: { kind: "constant", value: "predict-looked-at" },
            choosePicksKey: { kind: "constant", value: "predict-recycle" }
          }
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

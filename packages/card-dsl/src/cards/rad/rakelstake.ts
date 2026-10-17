import type { CardProgram } from "../../ir/index.js";

/**
 * Rakelstake (rad-165-167) — Battlefield, Colorless.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, rad-165-167):
 *   "For each player, the first time they play a unit or gear here each turn,
 *    they [Predict]. (They look at the top card of their Main Deck. They may
 *    recycle it.)"
 *
 * CR v1.5 anchors:
 * - 383.1 / 383.1.b: a triggered ability may be identified by "the first time";
 *   if the trigger condition is met multiple times at once, the ability
 *   triggers only once for the chosen instance.
 * - 359 / 407 / 383.4.a: playing a card is the event that puts it on the chain;
 *   "they play a unit or gear here" is a play event restricted to this
 *   Battlefield (053.3: Battlefields say "here").
 * - 437.1 / 437.3 / 437.3.a / 437.4: Predicting is looking at the top card of
 *   the Main Deck and choosing whether to Recycle it; "[Predict]" without a
 *   value predicts 1 card, and too few cards predict as many as possible
 *   without Burn Out. The parenthetical reminder does not add an ability.
 * - 190.6.a / 190.6.d: the Battlefield's abilities belong to its Controller;
 *   the ability's recipient is each player who plays the card, not only the
 *   Battlefield's controller.
 *
 * Status (cards/README.md §2, rechecked 2026-10-17): judge-required. The Predict
 * steps themselves are writable with merged primitives (Predict is now covered
 * by the merged effect.inspect + effect.recycle pair, executed in the golden;
 * RIFT-269's keyword actions map Predict through the same ops), but the
 * triggered ability cannot execute as written because these binding pieces are
 * missing:
 * 1. "they" is the player who played the card — an event participant. The IR has
 *    no event-player selector: effect.inspect takes a PlayerId Expr, and no
 *    ObjectSelector / Expr reads the triggering event's player (the same gap
 *    ogn/obelisk-of-power records). The "event-player" constant below is a
 *    documented placeholder, not executable data.
 * 2. "the first time they play a unit or gear here each turn" is per-player, per-
 *    turn, and restricted to plays at this Battlefield. TriggerSpec.once
 *    frequencies (per-turn / per-combat / per-chain / per-game) are scoped to
 *    one registration+source, not per event player, and the closed timing-point
 *    payload does not expose the play's destination Battlefield for a
 *    "played here" filter.
 * 3. the binding layer is merged (programs/triggers.ts), but this card's filter
 *    is still unusable: the engine trigger-spec validator rejects the sibling
 *    battlefield placeholder spelling (here: true) with an unknown-field issue,
 *    and translateTriggerFilter would silently drop here:true (over-triggering)
 *    if the strict validator were bypassed — fail-closed is the intended path,
 *    so production must supply a real destination filter before this trigger can
 *    register.
 * Order is preserved: Predict looks first, then the optional recycle of the
 * looked-at card (437.1), so the recycle is linked to the inspect step.
 * Dependencies: an event-player selector and per-player once frequency
 * (contract change request), a play-location payload/filter, and the production
 * registration path that feeds CardProgram triggers through
 * programs/triggers.ts (the adapter itself is merged).
 */
export default {
  canonicalCardId: "card.hash-1b896afb48233f602257054e1545c35265f320f21b47acd9ff53e914226707f7",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口（2026-10-17 复核，均不近似实现）：(1) 「they [Predict]」的接收者是事件玩家（打出该牌的玩家），" +
    "IR 没有事件玩家选择器：effect.inspect 的 player 只接受 PlayerId 表达式，ObjectSelector/Expr 都读不到触发事件的 player" +
    "（同 ogn/obelisk-of-power 的缺口）；程序里的 \"event-player\" 是缺选择器的占位值，不可执行。" +
    "(2) 「the first time they play a unit or gear here each turn」是每名玩家、每回合一次、且限定打出到本战场：" +
    "TriggerSpec.once 的频度键是单个 registration+source（events/pipeline.ts frequencyKey 用 source.ref），不是按事件玩家分别各一次；" +
    "封闭的 card-played 载荷也不暴露打出目的地战场，filter 的 here: true 仍是 053.3 的占位（引擎 trigger-spec 校验器不接受该键）。" +
    "(3) 绑定层已合入（programs/triggers.ts 的 triggerRegistrations/registerProgramTriggers），" +
    "但本卡的 filter 还不能用：引擎 trigger-spec 校验器把 here: true 记为 unknown-field（fail-closed），" +
    "translateTriggerFilter 若绕过严格校验会静默丢弃 here:true 造成过度触发，必须先有真实的打出目的地过滤。" +
    "Predict 本体（437.1/437.3.a/437.4）已用 effect.inspect + effect.recycle 表达并由 golden 真实执行。" +
    "依赖：契约变更请求（事件玩家选择器 + per-player once + 打出地点载荷），以及把 CardProgram " +
    "triggered ability 经已合入绑定层接进生产的主机接线。",
  sourceText:
    "For each player, the first time they play a unit or gear here each turn, they [Predict]. " +
    "(They look at the top card of their Main Deck. They may recycle it.)",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "card-played",
        // "they play a unit or gear here" (053.3): the play event restricted to
        // this Battlefield, for every player ("For each player"). `here` and
        // the object filter keep the sibling battlefield placeholder spelling;
        // `once` records the printed "the first time ... each turn" while the
        // per-player scoping stays missing (see judgeReason).
        filter: {
          event: "card-played",
          here: true,
          object: { type: ["unit", "gear"] }
        },
        once: "per-turn"
      },
      optional: false,
      body: [
        {
          // "they [Predict]" — 437.1/437.3.a: look at the top card of the
          // Main Deck and choose any number of seen cards (0..1) to recycle.
          // "event-player" is a documented placeholder for the missing
          // selector (see judgeReason); it is not a fabricated seat.
          id: "rakelstake.predict",
          op: "effect.inspect",
          args: {
            player: { kind: "constant", value: "event-player" },
            zone: { kind: "constant", value: "deck" },
            scope: { kind: "constant", value: "top" },
            amount: { kind: "constant", value: 1 },
            choose: { kind: "constant", value: true },
            chooseCount: { kind: "constant", value: { min: 0, max: 1 } },
            pickedKey: { kind: "constant", value: "rakelstake-picked" },
            choosePicksKey: { kind: "constant", value: "rakelstake-recycle" }
          }
        },
        {
          // 417.1.b / 417.4: recycling puts the chosen card on the bottom of
          // its owner's Main Deck; choosing none is an executed no-op. The
          // instruction is linked to Predict's linked result (437.1: the
          // recycle decision follows the look).
          id: "rakelstake.recycle",
          op: "effect.recycle",
          linkedTo: "rakelstake.predict",
          args: {
            objects: {
              kind: "linked",
              instructionId: "rakelstake.predict",
              key: "rakelstake-recycle"
            }
          }
        }
      ]
    }
  ]
} satisfies CardProgram;


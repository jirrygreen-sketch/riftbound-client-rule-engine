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
 * 2026-10-17 再复核：整卡仍为 judge-required；当前缺口见 judgeReason。
 * 已合入原语与关键词声明不等于生产链路可执行；局部执行证据见同名单卡测试。
 */
export default {
  canonicalCardId: "card.hash-1b896afb48233f602257054e1545c35265f320f21b47acd9ff53e914226707f7",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「they Predict」缺事件玩家表达式（event-player）：effect.inspect 的 player 无法读取触发事件玩家；TriggerSpec.once 的频度键是 registration+source+turn，仍缺 per-player once（CR 383.1、437.1）。" +
    "card-played 的生产事件现在保留进场后的 object.location 和 fromZone/printed 来源信息；缺口不是完全没有 destination 信息，而是 programs/filters.ts 没有把「here」绑定为来源战场与事件对象位置的比较。translateTriggerFilter 在 object 分支丢弃 sibling here:true，故现有过滤会过度触发。" +
    "本卡「每名玩家每回合第一次在此打出单位或装备」仍需来源相对地点过滤与按事件玩家分组的频度，不能用一个 per-turn 槽代替。Predict 的 inspect/recycle 已能执行，但当前 viewer 仍为占位值。",
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


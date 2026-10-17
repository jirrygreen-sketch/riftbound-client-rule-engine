import type { CardProgram } from "../../ir/index.js";

/**
 * Ember Monk — CR v1.5 811 and 412.4.
 * Self +2 Might is a nontargeted temporary continuous effect.
 * The remaining gap is a trustworthy Hidden origin on the card-played event
 * and its trigger-filter translation, rather than the merged Might primitive.
 */
export default {
  canonicalCardId: "card.hash-2845da03b74c83b71b9acc70abe634678cc7dd57b5a5ab5a2dbc7386c52d089a",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "仍缺 card-played 的 Hidden 打出来源判别：chain/engine.ts 发出事件时未保留打出前的 facedown/Hidden 来源，programs/filters.ts 也未翻译 fromHidden，因而无法按 CR 811 与 412.4 只匹配你从 Hidden 打出的牌。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "card-played",
        filter: { event: "card-played", player: "controller", filter: { fromHidden: true } }
      },
      optional: false,
      body: [
        {
          id: "ember-monk.grant-might",
          op: "continuous.might",
          args: {
            amount: { kind: "constant", value: 2 },
            duration: { kind: "constant", value: "this-turn" },
            objects: { kind: "constant", value: { kind: "source" } }
          }
        }
      ]
    }
  ],
  sourceText: "When you play a card from [Hidden], give me +2 :rb_might: this turn."
} satisfies CardProgram;

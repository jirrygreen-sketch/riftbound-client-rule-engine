import type { CardProgram } from "../../ir/index.js";

/**
 * Ember Monk — CR v1.5 811 and 412.4.
 * Self +2 Might is a nontargeted temporary continuous effect.
 * Hidden origin and its trigger filter still need an adapter. Repeated Chain
 * resolutions also need distinct settlement identities for the Might grants.
 */
export default {
  canonicalCardId: "card.hash-2845da03b74c83b71b9acc70abe634678cc7dd57b5a5ab5a2dbc7386c52d089a",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "仍缺 card-played 的 Hidden 来源快照及 fromHidden 过滤适配：chain/engine.ts 只发出打出后的 object 和 player，未保留 facedown 起始区域/隐藏战场，programs/filters.ts 未翻译 fromHidden（CR 811.1.c.3、412.4）。continuous.might 原语已可叠加，但 Chain 解释器未在不同结算间保留 settlement 计数，同来源连续结算本卡正文会重复注册 effect ID，尚缺多次 +2 本回合叠加的程序接线。",
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

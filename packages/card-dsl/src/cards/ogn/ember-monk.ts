import type { CardProgram } from "../../ir/index.js";

/**
 * Ember Monk — CR v1.5 811 and 412.4.
 * Self +2 Might is a nontargeted temporary continuous effect.
 * Hidden origin and its trigger filter still need an adapter.
 * Repeated Chain resolutions still reuse a settlement identity because the
 * interpreter qualifies its write key but not its read key.
 */
export default {
  canonicalCardId: "card.hash-2845da03b74c83b71b9acc70abe634678cc7dd57b5a5ab5a2dbc7386c52d089a",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "仍缺 card-played 的 Hidden 来源快照及 fromHidden 过滤适配：chain/engine.ts 只发出打出后的 object 和 player，未保留 facedown 起始区域/隐藏战场，programs/filters.ts 未翻译 fromHidden（CR 811.1.c.3、412.4）。continuous.might 原语本身可叠加，但 Chain 解释器的 settlement 计数写入带指令路径前缀的键，读取却使用未加前缀的键；同来源第二次结算仍使用 settlement-1，重复注册持续效果 ID 并抛出 Continuous effect already registered，尚不能保证本回合多次 +2 叠加。",
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

import type { CardProgram } from "../../ir/index.js";

/**
 * Ember Monk (ogn-167-298) — Unit, Chaos (Bandle City).
 *
 * sourceText (packages/card-data/data/deck-catalog.json, ogn-167-298):
 *   When you play a card from [Hidden], give me +2 :rb_might: this turn.
 *
 * Modeling (CR v1.5):
 * - The trigger is a card-played trigger scoped to plays out of Hidden. The
 *   merged card-played payload carries no "played from Hidden/facedown"
 *   discriminator, and Hidden's own expansion (811) is still the static
 *   cost.hidden placeholder, so the fromHidden gate below records the intended
 *   filter but is not executable.
 * - "give me +2 :rb_might: this turn" is a temporary Might modification
 *   (layers continuous.might); effect.buff only places Buff counters (703),
 *   so the +2 is not approximated as a Buff counter.
 */
export default {
  canonicalCardId: "card.hash-2845da03b74c83b71b9acc70abe634678cc7dd57b5a5ab5a2dbc7386c52d089a",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺两块已合入依赖：(1)「When you play a card from [Hidden]」需要 card-played 事件携带被与否决的" +
    "facedown/Hidden 打出来源判别（CR 811.1.d），现有时点 payload 无该字段，Hidden 关键词展开目前" +
    "只有 cost.hidden 静态占位；(2) continuous.might 与 end-of-turn 图层消费已经合入，+2 Might 局部效果可执行，" +
    "但卡牌程序触发绑定仍需把来源字段接入正式事件链。依赖：RIFT-257（CardProgram/事件绑定）与 RIFT-261（cost.hidden 消费）。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "card-played",
        filter: { event: "card-played", filter: { fromHidden: true } }
      },
      optional: false,
      body: [
        {
          id: "ember-monk.grant-might",
          op: "continuous.might",
          args: {
            amount: { kind: "constant", value: 2 },
            duration: { kind: "constant", value: "this-turn" },
            target: { kind: "constant", value: "ember-monk.self" }
          },
          targets: [
            {
              id: "ember-monk.self",
              filter: { object: "self", type: "unit" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ],
  sourceText: "When you play a card from [Hidden], give me +2 :rb_might: this turn."
} satisfies CardProgram;

import type { CardProgram } from "../../ir/index.js";

/**
 * Sett, Brawler (ogn-164-298) — Unit, Body.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, ogn-164-298):
 *   When I'm played and when I conquer, buff me. (If I don't have a buff, I get
 *   a +1 :rb_might: buff.)
 *   Spend my buff: Give me +4 :rb_might: this turn.
 *
 * Modeling (CR v1.5):
 * - "When I'm played" is the Play Effect trigger (383.4.a), i.e. the
 *   card-played timing point filtered to this card; "when I conquer" is the
 *   conquer trigger (471.1 / 473.2.a). Both use the merged effect.buff
 *   primitive, whose target spec is anchored to the ability host with the
 *   ObjectSelector "self" (contract 3.6); "buff me" only places the single
 *   Buff counter of 702.2.a/702.3, nothing else.
 * - "Spend my buff: Give me +4 :rb_might: this turn." is an activated ability
 *   (381) whose cost spends one Buff (702.2.b, the "spend-buff" nonstandard
 *   cost kind of the merged cost plan). The effect is a temporary Might
 *   modification, which belongs to a layers "continuous.might" consumer
 *   (703 gives a Buff only its own +1 Might); no such instruction is
 *   registered yet, so the card stays judge-required and the +4 grant is not
 *   approximated with buff counters.
 */
export default {
  canonicalCardId: "card.hash-7f8a999072e7b65566be686c006f6ade129a206d08922b9e25ebe2d9167d26ae",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「Spend my buff: Give me +4 :rb_might: this turn」需要带 end-of-turn 期限的 continuous.might 持续效果；" +
    "CR 703 的 Buff 只各自贡献 +1 Might，临时 +4 属图层修正，effect.buff 明确不含临时 Might 修改；" +
    "当前没有已注册的 continuous.might 原语，故整卡不宣称可执行，不把 +4 近似成 Buff 计数器。" +
    "spend-buff 费用与两条 buff 触发已按已合入原语写全。依赖：RIFT-91（layers-continuous）。",
  abilities: [
    {
      kind: "triggered",
      trigger: { at: "card-played", filter: { event: "card-played", filter: { source: "self" } } },
      optional: false,
      body: [
        {
          id: "sett.buff-on-played",
          op: "effect.buff",
          args: {
            mode: { kind: "constant", value: "buff" },
            target: { kind: "constant", value: "sett.self" }
          },
          targets: [
            {
              id: "sett.self",
              filter: { object: "self", type: "unit" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    },
    {
      kind: "triggered",
      trigger: { at: "conquer", filter: { event: "conquer", filter: { source: "self" } } },
      optional: false,
      body: [
        {
          id: "sett.buff-on-conquer",
          op: "effect.buff",
          args: {
            mode: { kind: "constant", value: "buff" },
            target: { kind: "constant", value: "sett.self" }
          },
          targets: [
            {
              id: "sett.self",
              filter: { object: "self", type: "unit" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    },
    {
      kind: "activated",
      cost: {
        kind: "activated",
        payments: [
          {
            kind: "spend-buff",
            object: "self",
            amount: { kind: "constant", value: 1 }
          }
        ]
      },
      timing: "action",
      body: [
        {
          id: "sett.grant-might",
          op: "continuous.might",
          args: {
            amount: { kind: "constant", value: 4 },
            duration: { kind: "constant", value: "this-turn" },
            target: { kind: "constant", value: "sett.self" }
          },
          targets: [
            {
              id: "sett.self",
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
  sourceText:
    "When I'm played and when I conquer, buff me. (If I don't have a buff, I get a +1 :rb_might: buff.)\n" +
    "Spend my buff: Give me +4 :rb_might: this turn."
} satisfies CardProgram;

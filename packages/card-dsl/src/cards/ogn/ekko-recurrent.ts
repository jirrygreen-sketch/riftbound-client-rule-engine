import type { CardProgram } from "../../ir/index.js";

/**
 * Ekko, Recurrent — CR v1.5 805, 808 and 383.3.b.
 * Additional-cost planning/payment and Chain enter-ready support are merged.
 * Program binding still must translate accelerate.cost into the selected
 * optional cost, attach the Deathknell body, and finalize the leading Recycle
 * cost against the card in Trash before resolving the rune-ready effect.
 */
const ekkoRecurrent = {
  canonicalCardId: "card.hash-20b19f69eca1bec8914d6f44145077493010be44bbcce72961eaa633e8a62bd2",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "仍缺 KeywordDef 到 Chain 的适配：accelerate.cost 未由 programs/play.ts 转成 optionalAdditional，付费生成的入场就绪替代尚未与关键词展开连接（CR 805.2.b/805.6.a）。Deathknell 展开的 trigger.leave 未与本卡正文连接，cause/destination 过滤未翻译（CR 808.1.d）。programs/triggers.ts 也未把开头「Recycle me」提取为触发基础费用，TriggeredAbility 无 cost 字段；现有 Chain 已支持对 Trash 当前入区对象支付 recycle 费用，但本卡仍须在 Finalize 完成该绑定后才结算 ready（CR 383.3.b/383.3.b.1），不能用 linkedTo 代替费用支付。",
  abilities: [
    { kind: "keyword", keyword: "accelerate" },
    { kind: "keyword", keyword: "deathknell" },
    {
      kind: "triggered",
      trigger: {
        at: "object-killed",
        filter: { event: "object-killed", filter: { role: "self" } }
      },
      optional: false,
      body: [
        {
          // CR 383.3.b: retained as leading-cost data until the adapter extracts
          // this payment at Finalize; not a valid full Deathknell resolution.
          id: "ekko.recycle-me",
          op: "effect.recycle",
          args: {
            objects: { kind: "object-property", object: "self", property: "ref" }
          }
        },
        {
          id: "ekko.ready-runes",
          op: "effect.ready",
          args: {
            objects: {
              kind: "constant",
              value: {
                kind: "query",
                filter: { zone: "rune-zone", type: "rune", controller: "self" }
              }
            }
          }
        }
      ]
    }
  ],
  sourceText:
    "[Accelerate] (You may pay :rb_energy_1::rb_rune_mind: as an additional cost to have me enter ready.)\n" +
    "[Deathknell] — Recycle me to ready your runes. (When I die, get the effect.)"
} satisfies CardProgram;

export default ekkoRecurrent;

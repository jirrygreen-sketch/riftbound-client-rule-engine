import type { CardProgram } from "../../ir/index.js";

/**
 * ogn-233-298 Grand Strategem (Spell, Order, 6 energy + 3 Order power) — RIFT-143 shard 8.
 *
 * Catalog evidence (deck-catalog.json, dataVersion 2026-10-12-official-gallery):
 * cardType Spell, domains ["Order"], energy 6, power 3, might null.
 *
 * Printed text:
 *   [Action] (Play on your turn or in showdowns.)
 *   Give friendly units +5 :rb_might: this turn.
 *
 * Status: judge-required. The buff is faithfully described below, but no merged
 * primitive performs a temporary Might modification:
 * - contract 3.6's closed GameAction list has no Might-modification action;
 * - effect.buff's own header states that temporary Might changes "belong to
 *   continuous.might, never to this primitive" (CR 702/703 Buff counters are a
 *   different object characteristic), and this card must not be turned into
 *   Buff counters;
 * - the layers engine (layers/engine.ts) already consumes `continuous.might`-shaped
 *   arithmetic effects registered through `ctx.addContinuous`, but
 *   effects/instructions/ has no registered instruction that reaches it
 *   (RIFT-91 layers-continuous workstream); the end-of-turn expiry is owned by
 *   continuous.duration.
 *
 * "friendly units" is a criteria-based set (each/all), not a choice: no unit is
 * chosen, so nothing is targeted (355.5.a/355.10.d) and no TargetSpec is written.
 */
const grandStrategem = {
  canonicalCardId: "card.hash-c93cf1fcde5c50351fa2b80cc594925df51669816b5ce25ba223e27376c47b3a",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺临时 Might 修正原语：契约 3.6 封闭 GameAction 集合没有 Might 修改动作，" +
    "effect.buff 明确临时 Might 归 continuous.might（不是 Buff counter，CR 702/703），" +
    "而 layers 消费方（continuous.might + continuous.duration 的回合末到期）到 RIFT-91 才合入；" +
    "不近似实现，也不把 +5 Might 写成 Buff。",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      body: [
        {
          // "Give friendly units +5 Might this turn" — the pending layers
          // instruction shape; no merged primitive consumes it yet.
          id: "grand-strategem.might",
          op: "continuous.might",
          args: {
            amount: { kind: "literal", value: 5 },
            duration: { kind: "literal", value: "this-turn" },
            appliesTo: {
              kind: "literal",
              value: { type: "unit", controller: "controller", zone: "board" }
            }
          }
        }
      ]
    }
  ],
  sourceText: "[Action] (Play on your turn or in showdowns.)\nGive friendly units +5 :rb_might: this turn."
} satisfies CardProgram;

export default grandStrategem;

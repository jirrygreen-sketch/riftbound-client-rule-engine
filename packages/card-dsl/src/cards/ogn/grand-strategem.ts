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
 * Status: judge-required. The temporary Might instruction and its layers
 * consumer are merged; the remaining gap is binding this card program into
 * the complete play/cost path (RIFT-257 / RIFT-261).
 *
 * "friendly units" is a criteria-based set (each/all), not a choice: no unit is
 * chosen, so nothing is targeted (355.5.a/355.10.d) and no TargetSpec is written.
 */
const grandStrategem = {
  canonicalCardId: "card.hash-c93cf1fcde5c50351fa2b80cc594925df51669816b5ce25ba223e27376c47b3a",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "continuous.might 与 continuous.duration 已能注册并由 layers 消费；当前缺卡牌程序到 play/cost 的完整绑定与费用支付（RIFT-257 / RIFT-261），" +
    "以及 [Action] 的完整行动准入链。不能把 +5 Might 近似写成 Buff。",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      body: [
        {
          // "Give friendly units +5 Might this turn" — a non-targeting set
          // registration consumed by continuous.might.
          id: "grand-strategem.might",
          op: "continuous.might",
          args: {
            amount: { kind: "literal", value: 5 },
            duration: { kind: "literal", value: "this-turn" },
            filter: {
              kind: "constant",
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

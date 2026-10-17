import type { CardProgram } from "../../ir/index.js";

/**
 * Kadregrin the Infernal (ogn-038-298), CR v1.5 706-711 / 355.10.d.
 * Count friendly Mighty units on Board at resolution using current layered
 * Might >= 5, then draw that many. programs/ already binds the self play trigger.
 * The remaining gap is an executable numeric predicate inside a set query:
 * mightyCondition compares one host's Might, while count/query does not apply
 * mightGte to every candidate (RIFT-359). Never count all friendly units instead.
 */
const kadregrinTheInfernal = {
  canonicalCardId: "card.hash-398b3826ce23339dadae173c5f1fa39994abe8d2eed99f68d1de01806763d379",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺 count/query 的 Mighty 候选谓词（RIFT-359）：CR 706-708/710 要求友方在场单位按结算时当前图层 Might >= 5 计数；" +
    "mightyCondition 可比较单一宿主，但集合查询的 mightGte 尚无数值比较消费方。" +
    "需将该谓词用于每个候选；不能把普通友方单位计数当成 Mighty 计数。",
  abilities: [
    {
      kind: "triggered",
      trigger: { at: "card-played", filter: { self: true } },
      optional: false,
      body: [
        {
          id: "kadregrin.draw-per-mighty",
          op: "effect.draw",
          args: {
            amount: {
              kind: "count",
              subject: "units",
              filter: { type: "unit", controller: "self", zone: "board", mightGte: 5 }
            }
          }
        }
      ]
    }
  ],
  sourceText:
    "When you play me, draw 1 for each of your [Mighty] units. (A unit is Mighty while it has 5+ :rb_might:.)"
} satisfies CardProgram;

export default kadregrinTheInfernal;

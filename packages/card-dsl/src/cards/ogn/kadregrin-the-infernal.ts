import type { CardProgram } from "../../ir/index.js";

/**
 * Kadregrin the Infernal (ogn-038-298), CR v1.5 707/708/710.
 * 当前复核：card-played 自引用订阅与 effect.draw 可执行；集合查询仍未实现
 * 按候选当前图层 Might >= 5 筛选。事件/结果谓词不能代替集合数值谓词。
 */
const kadregrinTheInfernal = {
  canonicalCardId: "card.hash-398b3826ce23339dadae173c5f1fa39994abe8d2eed99f68d1de01806763d379",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺 Mighty 集合数值谓词：CountExpr.filter 中的 mightGte 未被 layers/filter.ts 或 chain/engine.ts 的查询消费，" +
    "会被静默忽略；须按每个友方在场候选的当前图层 Might >= 5 计数（CR 707/708/710），" +
    "不能只数友方单位，也不能只比较宿主。已合入的事件/结果谓词不提供该逐候选比较。",
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

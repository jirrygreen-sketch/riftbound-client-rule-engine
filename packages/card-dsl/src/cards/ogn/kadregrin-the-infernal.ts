import type { CardProgram } from "../../ir/index.js";

/**
 * Kadregrin the Infernal (ogn-038-298) — Unit, Fury, Dragon/Demacia.
 * energy 9, power 2 (Fury), Might 9.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, ogn-038-298):
 *   "When you play me, draw 1 for each of your [Mighty] units. (A unit is Mighty
 *    while it has 5+ :rb_might:.)"
 *
 * 规则依据（CR v1.5）：
 * - 383.4.a："When you play me" 是打出触发（时点 card-played，filter 指向自身）。
 * - 706-708/710：Mighty 是描述——单位"is Mighty"当且仅当它的 Might ≥ 5（在
 *   场上的单位按当前 Might 判定，710）。"your [Mighty] units" 是不选目标的集合
 *   查询（355.10.d：按特征程序化选择，不是 target），因此计数写成 count 表达式，
 *   指令不带 TargetSpec。
 * - "draw 1 for each" 的抽取数量 = 上述集合的元素个数，用 effect.draw 的 amount
 *   表达式在结算时求值（契约 3.6 evaluate 时机）；不足时按 414.4/432 由内核处理
 *   Burn Out。
 *
 * status：judge-required。Mighty 的 KeywordDef（RIFT-88）已合入，但没有查询消费方：
 * 合并的 ObjectFilter 实现（layers/filter.ts、参考内核 matchesFilter、chain/engine.ts 的
 * query 归一化）只识别 type/tags/controller/owner/zone/location/states 等键，
 * 不识别 mightGte（或等价的 is-mighty 谓词），未知键被静默忽略——直接按 710 写
 * mightGte: 5 会让计数把非 Mighty 单位也算进去，等于近似实现。
 * effect.draw 已合入并有真实执行测试；触发侧还缺 CardProgram → TriggerRegistration
 * 绑定（RIFT-257）。依赖：Mighty 谓词的过滤器/查询消费方（RIFT-91 后续）与 RIFT-257。
 */
const kadregrinTheInfernal = {
  canonicalCardId: "card.hash-398b3826ce23339dadae173c5f1fa39994abe8d2eed99f68d1de01806763d379",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺「Mighty 单位集合」的查询消费方：Mighty 的 KeywordDef（RIFT-88）已合入，但它只提供 " +
    "condition.value/is-mighty 的静态形状；合并的 ObjectFilter 实现（layers/filter.ts、参考内核 matchesFilter、" +
    "chain/engine.ts 的 query 归一化）只识别 type/tags/controller/owner/zone/location/states，不识别 mightGte/mighty，" +
    "未知键被静默忽略，计数会把非 Mighty 单位算进去，构成近似实现（CR 706-708/710 要求在场上按当前 Might >= 5 判定）。" +
    "effect.draw 已合入并有真实执行测试；触发侧还缺 CardProgram → TriggerRegistration 的订阅方（RIFT-257）。" +
    "依赖：Mighty 谓词的过滤器/查询消费方（RIFT-91 后续）与 RIFT-257。不近似实现。",
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
              filter: { type: "unit", controller: "controller", mightGte: 5 }
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

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
 * status：judge-required。缺合并后的「Mighty 集合谓词」：Mighty 关键词文件只把
 * is-mighty 谓词声明成 condition.value 的静态效果形状，没有等价的查询过滤器；
 * 当前合并的 query filter 只识别 type/tags/controller/owner/zone/location 等键，
 * 不识别 mightGte/mighty 键——直接写上会让计数把非 Mighty 单位也算进去，等于
 * 近似实现。依赖：RIFT-88（kw-mighty 的谓词落地）与 RIFT-91（图层/条件消费）。
 * draw 原语本身已合入，golden 测试对固定数量的 draw 场景做真实执行。
 */
const kadregrinTheInfernal = {
  canonicalCardId: "card.hash-398b3826ce23339dadae173c5f1fa39994abe8d2eed99f68d1de01806763d379",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺「Mighty 单位集合」的查询谓词：Mighty（CR 706-708）目前只有 keywords/Mighty.ts 的 condition.value/is-mighty 静态形状，" +
    "合并的 ObjectFilter 查询不识别 mightGte/mighty 键（当前只按 type/tags/controller/owner/zone/location 过滤），" +
    "计数会把非 Mighty 单位算进去，构成近似实现。依赖：RIFT-88（kw-mighty 谓词落地）、RIFT-91（图层/条件消费）。" +
    "effect.draw 原语已合入。",
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

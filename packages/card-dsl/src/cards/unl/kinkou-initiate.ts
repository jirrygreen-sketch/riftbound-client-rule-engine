import type { CardProgram } from "../../ir/index.js";

/**
 * Kinkou Initiate (unl-097-219) — Unit, Body, Ionia; energy 3, Might 3.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, unl-097-219, verbatim):
 *   When you play me, draw 1 if your other units have total Might 5 or more.
 *
 * Rules evidence (Core Rules v1.5):
 * - 383.4.a / 383.4.a.1: "When you play me" is a Play Effect — a Triggered
 *   Ability whose Condition includes the permanent that is being played. The
 *   closed timing point is "card-played" (events/timing-points.ts), and the
 *   filter points at the ability host through the contract 3.6 symbolic
 *   selector {source: "self"} (cloud-drake / gem-jammer spelling).
 * - 383.2.a.1: only a conditional statement *immediately after* the Condition
 *   is part of the Trigger Condition. Here "if your other units have total
 *   Might 5 or more" follows the instruction "draw 1", so it belongs to the
 *   Effect (same shape as the Loose Cannon example) and is encoded as the v1.5
 *   instruction-scoped `condition` (contract 3.2 / 3.4) on the draw.
 * - 414.1 / 414.3: "draw 1" is effect.draw with the printed amount 1; the
 *   drawer is the implicit "you" = ability controller (190.6.d).
 * - 143.1 / 143.1.b, 143.2.a / 143.2.a.1: "your other units" is the set of
 *   board units the controller controls aside from the host, and "total Might"
 *   sums their Effective Might.
 *
 * Status: judge-required. The printed gate needs the sum of a filtered set's
 * Might, which the frozen Expr algebra cannot produce: `count` counts matching
 * objects and `object-property` reads one object's characteristic, and no
 * merged form returns Σ Might of "your other units" (contract 3.2 Expr has no
 * sum/reduce). The retained `count` subject/filter records that gap and is not
 * an approximation of the 5-Might total; the draw primitive itself is merged
 * and executed for real by the golden test.
 */
export default {
  canonicalCardId: "card.hash-578f670d7fdae87fd32e34179e331f901a8f108dcb51c337c971db00b3e3c498",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺「合计 Might」值表达式：'if your other units have total Might 5 or more' 需要把一组对象" +
    "（你控制的、除我以外的场上单位）的 Effective Might（143.2.a.1）求和后与 5 比较，" +
    "但冻结的 Expr 只有 count（计数）与 object-property（读单个对象特征），没有 sum-over-set / reduce 形式；" +
    "contract 3.2 的 Expr 需要新增该值表达式（RIFT-9 表达式清单）。程序里 count 的 subject " +
    "'other-friendly-units-total-might' 只是该缺口的描述性占位，不近似实现印刷语义。" +
    "抽牌原语 effect.draw 已合入并有执行测试。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "card-played",
        filter: { event: "card-played", filter: { source: "self" } }
      },
      optional: false,
      body: [
        {
          id: "kinkou-initiate.draw",
          op: "effect.draw",
          args: { amount: { kind: "constant", value: 1 } },
          // 383.2.a.1：“if …” 紧跟指令而非紧跟触发条件 → 属于效果，写在本条指令的 condition 上。
          condition: {
            kind: "compare",
            left: {
              kind: "count",
              subject: "other-friendly-units-total-might",
              filter: { type: "unit", zone: "board", controller: "self", exclude: "self" }
            },
            operator: "gte",
            right: { kind: "constant", value: 5 }
          }
        }
      ]
    }
  ],
  sourceText: "When you play me, draw 1 if your other units have total Might 5 or more."
} satisfies CardProgram;

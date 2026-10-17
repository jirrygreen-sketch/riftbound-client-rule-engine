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
 * Status: judge-required. Re-checked against the merged instruction, program-
 * binding and continuous-effect batches (RIFT-257/258/259, 2026-10-16):
 * - The printed gate still needs the sum of a filtered set's Might. `count`
 *   counts matching objects and `object-property` reads one object's
 *   characteristic; no merged Expr returns Σ Effective Might of "your other
 *   units" (contract 3.2 Expr has no sum/reduce form). The retained `count`
 *   subject/filter records that gap and is not an approximation of the 5-Might
 *   total.
 * - The `card-played` trigger and the draw body do bind: programs/filters.ts
 *   translates `{source: "self"}` to the host object id and
 *   programs/triggers.ts registers the subscription, so the merged halves have
 *   real execution evidence. The gate cannot be attached honestly: the
 *   production filter translator (programs/filters.ts) rejects the `exclude`
 *   anchor used by the retained filter ("Unsupported filter field exclude"), so
 *   the count placeholder would silently count the host itself instead of
 *   failing closed.
 * Dependencies: a sum-over-set Expr plus the `exclude` anchor in the program
 * filter translator (RIFT-9 expression inventory, RIFT-257 follow-up). Not
 * approximated.
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
    "已合入并可由 golden 真实执行的部分：card-played 触发（programs/filters.ts 把 {source: \"self\"} 归一化为宿主对象、" +
    "programs/triggers.ts 注册订阅，RIFT-257）与 effect.draw 抽 1 张。" +
    "条件本身还缺消费方：程序绑定侧的 filter 翻译器（engine-core/src/programs/filters.ts）不接受 retain 的 " +
    "exclude 锚点（报 Unsupported filter field exclude），因此即使换成 count 也会把宿主自己算进去而不是失败关闭。" +
    "依赖：sum-over-set 表达式（RIFT-9）与程序绑定 filter 锚点（RIFT-257 后续）。不近似实现。",
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

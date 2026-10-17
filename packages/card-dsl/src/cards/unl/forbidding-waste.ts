import type { CardProgram } from "../../ir/index.js";

/**
 * Forbidding Waste (unl-210-219) — Battlefield, Colorless.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, unl-210-219, 逐字):
 *   "While a unit here is defending alone, it has -2 :rb_might:. (It's alone if
 *    there are no other friendly units here.)"
 *
 * CR v1.5 anchors:
 * - 364.3 / 364.3.a: "While …" is a Conditional Passive Ability; passive
 *   abilities of a permanent are active while it is on the Board (365.1).
 * - 740.2.a: "A unit is alone when there are no other friendly units at the
 *   same location" — the parenthetical restates this definition and adds no
 *   ability (135.2.b reminder text).
 * - 814.1.d: being a defender means the Unit has gained the Defender
 *   designation during Combat (461 / 466.2.c.3); the merged ObjectSnapshot has
 *   no combat-role/designation characteristic yet (contract §3.8 adds
 *   `combatRole`, not yet present in engine-core's effects/contract.ts).
 * - 143.2.a / 476 / 479.4: "has -2 :rb_might:" is an arithmetic-layer Might
 *   modification (479.4.e.1 applies increases before decreases).
 * - 143.2.c: reducing Might below 0 is treated as 0 when referenced; that
 *   clamp is the kernel's derived-Might rule, not a printed minimum (there is
 *   no printed "to a minimum of" here).
 * - 053.3 / 199.1: "here" is this Battlefield.
 *
 * Status: judge-required — the merged dependencies remove none of these three gaps:
 * 1. no merged implementation turns a CardProgram static ability into a layers
 *    ContinuousEffectSpec: programs/statics.ts only exposes the bindStatic callback seam
 *    (RIFT-257) and registerContinuousEffect still has no production caller, so this -2 cannot
 *    be installed (RIFT-91 follow-up; same gap as rad/packed-amphitheater).
 * 2. layers/filter.ts implements no sameLocationAs anchor, so the declared filter would leak
 *    the -2 to units at every Battlefield instead of 053.3/199.1’s "here".
 * 3. the conditions cannot be evaluated: layers/engine.ts conditionMatches returns true for
 *    every condition kind except always/never/type/has-tag/has-keyword, so the compare below
 *    is not evaluated, the 740.2.a "alone" predicate needs a location-relative count of other
 *    friendly units that the layer filter cannot express, and 814.1.d’s Defender designation
 *    has no producer in combat/ (contract §3.8 combatRole exists on ObjectSnapshot but is
 *    never set by the merged combat flow).
 * The program keeps the exact printed shape (arithmetic -2 for units at this Battlefield,
 * gated on defending + alone) so the gaps stay auditable; the golden test asserts
 * identity/structure and records the missing registration, filter anchors and
 * designation/predicate support as test.todo.
 * Dependencies: RIFT-257/RIFT-91 (card static -> layer registration, sameLocationAs and
 * count/exclude predicates in the layer filter) and the 814.1.d Defender designation fed
 * from combat (RIFT-124 follow-up).
 */
export default {
  canonicalCardId: "card.hash-62355f7fd2699dda34a1601a315ab1ee9095ff67da700d49567b54955780324f",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "(1) 没有任何已合入实现把 CardProgram 的 static 能力注册成 layers/LayerEngine 的 ContinuousEffectSpec：" +
    "programs/statics.ts 只提供 bindStatic 回调接缝（RIFT-257），registerContinuousEffect 仍没有生产调用方，" +
    "本卡的 -2 无法安装（RIFT-91 后续，同 rad/packed-amphitheater）。" +
    "(2) layers/filter.ts 不实现 053.3 的 sameLocationAs 锚点：按声明注册会把 -2 加到所有战场上的单位（与「a unit here」不符，过度应用）。" +
    "(3) 条件无法求值：layers/engine.ts 的 conditionMatches 只认 always/never/type/has-tag/has-keyword，其余 Condition 一律返回 true；" +
    "「defending」需要 814.1.d/466.2.c.3 的 Defender designation（契约 3.8 的 combatRole 字段虽在 ObjectSnapshot 上，但合并的战斗流程从不设置它），" +
    "「alone」需要 740.2.a 的同地点其他友方单位计数（解释器的 count/sameLocationAs/exclude 词汇不被 layers 读取）。" +
    "程序保留精确的印刷形状（arithmetic 层 -2、here 锚点、defending + alone 门）供审查；不近似实现、不改写成 Buff 计数器（CR 702/703 是另一种对象）。" +
    "依赖：RIFT-257/RIFT-91 后续与 814.1.d 的 designation 生产方（RIFT-124 后续）。",
  sourceText:
    "While a unit here is defending alone, it has -2 :rb_might:. " +
    "(It's alone if there are no other friendly units here.)",
  abilities: [
    {
      kind: "static",
      effect: {
        kind: "continuous.might",
        // 479.4 / 479.4.e.1: a Might reduction is an arithmetic-layer effect;
        // the merged engine already separates increases from decreases.
        mode: "add",
        layer: "arithmetic",
        amount: { kind: "constant", value: -2 },
        filter: {
          type: "unit",
          zone: "board",
          // 053.3/199.1: "here" is this Battlefield (anchor not implemented by
          // the merged layer filter — see judgeReason).
          sameLocationAs: "self"
        }
      },
      // 364.3.a: "While …" is the Conditional Passive Ability gate.
      condition: {
        kind: "all",
        conditions: [
          {
            // 814.1.d: the unit holds the Defender designation. The merged
            // ObjectSnapshot has no combatRole/designation characteristic yet
            // (contract §3.8); this names the intended predicate without
            // inventing a value.
            kind: "expression",
            value: { kind: "constant", value: "self-is-defending" }
          },
          {
            // 740.2.a: alone = no other friendly units at the same location.
            // The interpreter's count vocabulary is used so the rule text is
            // auditable, but the layers engine does not evaluate compare
            // conditions (see judgeReason).
            kind: "compare",
            left: {
              kind: "count",
              subject: "other-friendly-units-here",
              filter: {
                type: "unit",
                zone: "board",
                controller: "self",
                sameLocationAs: "self",
                exclude: "self"
              }
            },
            operator: "eq",
            right: { kind: "constant", value: 0 }
          }
        ]
      }
    }
  ]
} satisfies CardProgram;

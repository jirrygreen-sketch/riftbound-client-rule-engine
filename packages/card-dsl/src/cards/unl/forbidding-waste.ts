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
 * Status: judge-required — three merged gaps, none approximated:
 * 1. no merged path registers a CardProgram's static ability as a
 *    ContinuousEffectSpec (registerContinuousEffect has no caller; engine-core
 *    never reads card-program abilities), so the layer effect cannot be
 *    installed (RIFT-91 follow-up; same gap as rad/packed-amphitheater,
 *    ogn/wielder-of-water).
 * 2. the merged layer filter implements no sameLocationAs anchor, so the
 *    effect would leak to units at every Battlefield and mis-apply the -2.
 * 3. the conditions cannot be evaluated: `conditionMatches` in layers/engine.ts
 *    returns true for every condition kind except always/never/type/has-tag/
 *    has-keyword, so the compare conditions below are not evaluated, and the
 *    "alone" predicate needs a location-relative count of other friendly units
 *    that the frozen filter/query surface cannot express for a layer effect
 *    (the interpreter's count/sameLocationAs/exclude vocabulary is not read by
 *    the layers engine). The defending designation is likewise absent (the
 *    contract §3.8 combatRole field is not implemented).
 * The program keeps the exact printed shape (arithmetic -2 for units at this
 * Battlefield, gated on defending + alone) so the gaps stay auditable; the
 * golden test asserts identity/structure and records the missing registration,
 * filter anchors and designation/predicate support as `test.todo`.
 *
 * Dependencies: RIFT-91 follow-up (card→layer registration, sameLocationAs and
 * count/exclude predicates in the layer filter) and contract §3.8's
 * combatRole/designation characteristic with the combat wiring (engine batch 5,
 * combat/ is not bridged to the chain/events pipeline).
 */
export default {
  canonicalCardId: "card.hash-62355f7fd2699dda34a1601a315ab1ee9095ff67da700d49567b54955780324f",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口，均不近似实现：(1) 没有任何已合入路径把 CardProgram 的 static 能力注册成 layers/LayerEngine 的 ContinuousEffectSpec" +
    "（registerContinuousEffect 没有调用方，engine-core 不读取卡牌能力；RIFT-91 后续，同 rad/packed-amphitheater、ogn/wielder-of-water）。" +
    "(2) layers/filter.ts 不实现 053.3 的 sameLocationAs 锚点：按声明注册会把 -2 加到所有战场上的单位（与「a unit here」不符，过度应用）。" +
    "(3) 条件无法求值：layers/engine.ts 的 conditionMatches 只认 always/never/type/has-tag/has-keyword，其余 Condition 一律返回 true；" +
    "「defending」需要 814.1.d/466.2.c.3 的 Defender designation（契约 3.8 的 combatRole 字段未在 engine-core 落地），" +
    "「alone」需要 740.2.a 的同地点其他友方单位计数（解释器的 count/sameLocationAs/exclude 词汇不被 layers 读取）。" +
    "程序保留精确的印刷形状（arithmetic 层 -2、here 锚点、defending + alone 门）供审查；不近似实现、不改写成 Buff 计数器（CR 702/703 是另一种对象）。" +
    "依赖：RIFT-91 后续与契约 §3.8 combatRole/designation 及战斗接线（契约 §7.2 批 5）。",
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

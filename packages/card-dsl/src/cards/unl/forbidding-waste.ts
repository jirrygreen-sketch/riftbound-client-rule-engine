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
 * Status (packages/card-dsl/src/cards/README.md §2): judge-required — the
 * merged dependencies remove two of the old claims, three real gaps remain:
 * 1. 814.1.d's Defender designation has no producer in the merged combat flow:
 *    contract §3.8's combatRole exists on ObjectSnapshot but only the test
 *    kernel default sets it and no combat module assigns attacker/defender, so
 *    "is defending" has no evaluable predicate (the placeholder expression
 *    below records the intent without inventing semantics; RIFT-124 follow-up).
 * 2. the 740.2.a "alone" count cannot be evaluated in the static-condition
 *    query path: bindStaticToLayers evaluates the compare through
 *    abilityEnvironment, whose query resolves each filter with
 *    layers/filter.ts matchesObjectFilter — that implementation has no
 *    sameLocationAs/exclude anchors and resolves controller:"self" against the
 *    queried object's own controller (a match-all), so the count would be every
 *    unit at the source location instead of "other friendly units here". The
 *    interpreter's queryObjects (selectors.ts) does support the anchors, but
 *    static conditions do not run through that path.
 * 3. even with a bound handle, the layer filter compares the stored LocationRef
 *    by reference identity (with a type-only fallback), and the kernel clones
 *    snapshots, so same-Battlefield units fail the equality: production still
 *    needs per-object location matching in layers/filter.ts.
 * The program keeps the exact printed shape (arithmetic -2 for units at this
 * Battlefield, gated on defending + alone) so the gaps stay auditable; the
 * golden test proves the merged static binder installs the -2 as an arithmetic
 * ContinuousEffectSpec (the registration gap RIFT-257/RIFT-91 recorded is
 * closed) and the todos record the designation producer and the layer-filter
 * location/friendly-count gaps.
 * Dependencies: the 814.1.d Defender designation producer from combat
 * (RIFT-124 follow-up) and per-object same-location + friendly-only count
 * anchors in the layers filter (engine follow-up).
 */
export default {
  canonicalCardId: "card.hash-62355f7fd2699dda34a1601a315ab1ee9095ff67da700d49567b54955780324f",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "(1) 814.1.d 的 Defender designation 没有战斗流程生产者：契约 3.8 的 combatRole 只由测试内核默认，" +
    "合并后的战斗模块从不指派 attacker/defender，「is defending」没有可求值的真实谓词" +
    "（程序里的 expression 占位只记录意图，不发明语义；RIFT-124 后续）。" +
    "(2) 740.2.a 的「alone」计数在 static 条件求值路径不可求值：bindStaticToLayers 经 abilityEnvironment 求值 compare，" +
    "其 query 对每个过滤器走 layers/filter.ts 的 matchesObjectFilter——该实现没有 sameLocationAs/exclude 锚点，" +
    "且 controller:\"self\" 与被查对象自身的 controller 比较（恒真），数出来会是同一地点的全部单位而不是「其他友方单位」；" +
    "解释器 selectors.ts 的 queryObjects 虽支持这些锚点，但 static 条件不走该路径。" +
    "(3) 绑定后图层过滤器的 location 只做引用同一性比较（内核会克隆快照，同战场单位也不相等），" +
    "生产可用仍需 layers/filter.ts 落逐对象 location 匹配。" +
    "程序保留精确的印刷形状（arithmetic 层 -2、here 锚点、defending + alone 门）供审查；不近似实现、不改写成 Buff 计数器（CR 702/703 是另一种对象）。" +
    "已合入路径可把本 static 安装成 layers 的 ContinuousEffectSpec（golden 验证），缺口只剩 designation 生产者与图层过滤器的 here/友方计数。" +
    "依赖：RIFT-124 后续（designation 生产方）与 layers 过滤器的逐对象 location/友方计数锚点（引擎后续）。",
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

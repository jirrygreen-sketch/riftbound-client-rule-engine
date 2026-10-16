import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Trusty Ramhound (sfd-159-221) — Unit, 2 energy, Might 2, Order,
 * tags Dog / Elite / Demacia.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, sfd-159-221):
 *   While you have another unit here, I have +1 :rb_might:.
 *
 * Rules evidence (Core Rules v1.5):
 * - "While ..." introduces a Continuous Effect that applies as long as its
 *   condition holds (363.2.a / 383.2.b conditional continuous abilities); the
 *   +1 Might is applied in the arithmetic layer (143.2.a, 475–477).
 * - "another unit you control here": "another" excludes the source object
 *   (355.9.c), "you control" is the source's controller, and "here" is the
 *   source's current location (ObjectSelectors.sameLocationAs per contract
 *   3.6 / 359.3.f).
 * - The Might bonus is a static arithmetic-layer effect, not a Buff counter
 *   (702: a Buff is a counter, each one gives +1 Might, but this card never
 *   places one).
 *
 * Status: judge-required — the granularity this card needs is missing even
 * though the layers engine is merged (RIFT-91):
 * - packages/engine-core/src/layers/engine.ts evaluates a registered
 *   ContinuousEffectSpec through matchesObjectFilter + conditionMatches, and
 *   conditionMatches only understands kind always/never/type/has-tag/
 *   has-keyword — it returns true for every other Condition shape (including
 *   compare/count), so a count-based "another unit here" gate could never be
 *   honestly expressed; the "here" anchor is likewise absent from the layer
 *   filter.
 * - No merged consumer reads the amount of a card-program static ability whose
 *   value is a count expression ("another unit here" must be counted at
 *   evaluation time), and the card→layer registration path is not wired.
 * Dependencies: RIFT-91 follow-up (layer predicates: count/sameLocationAs/other
 * plus card-program continuous registration). The declared static effect below
 * records the intended shape; nothing is approximated and no Buff is placed.
 */
const abilities: Ability[] = [
  {
    kind: "static",
    effect: {
      kind: "continuous.might",
      mode: "add",
      layer: "arithmetic",
      appliesTo: "self",
      amount: { kind: "constant", value: 1 }
    },
    // "While you have another unit here" — the condition is recorded with the
    // count/sameLocationAs/other vocabulary it needs (355.9.c, 359.3.f); the
    // merged conditionMatches/filter cannot evaluate it (see judgeReason).
    condition: {
      kind: "compare",
      left: {
        kind: "count",
        subject: "other-units-here",
        filter: {
          type: "unit",
          zone: "board",
          controller: "controller",
          other: true,
          sameLocationAs: "self"
        }
      },
      operator: "gte",
      right: { kind: "constant", value: 1 }
    }
  }
];

const program = {
  canonicalCardId: "card.hash-88c1812cc994f155d1a08ed94e9690205a48e0ecd3e4d827b49d468bc6f8e69f",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "图层条件不足：已合入的 layers/engine.ts 的 conditionMatches 只识别 always/never/type/has-tag/has-keyword，其余 Condition（含 compare/count）一律返回 true，" +
    "因此「While you have another unit here」无法被诚实求值；「another」排除自身（355.9.c）与「here」同地点锚点（359.3.f）也不在图层过滤器里，" +
    "且没有把卡牌 static 效果注册进图层、并按计数求值 amount 的接线。" +
    "已按 143.2.a/475–477 声明为 arithmetic 层 static continuous.might：+1 是临时/静态 Might 修正，绝不用 702 的 Buff 计数器近似（本卡不放置 Buff）。" +
    "依赖：RIFT-91 后续（图层谓词 count/sameLocationAs/other 与卡牌持续效果注册）、RIFT-32/33（图层与同地点场景）。",
  abilities,
  sourceText: "While you have another unit here, I have +1 :rb_might:."
} satisfies CardProgram;

export default program;

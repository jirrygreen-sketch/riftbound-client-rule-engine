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
 *   +1 Might is applied in the arithmetic layer (143.2.a, 475–478).
 * - "another unit you control here": "another" excludes the source object
 *   (355.9.c), "you control" is the source's controller, and "here" is the
 *   source's current location; the contract 3.6 anchors are `exclude: "self"`
 *   and `sameLocationAs: "self"` (359.3.f referents).
 * - The Might bonus is a static arithmetic-layer effect, not a Buff counter
 *   (702: a Buff is a counter, each one gives +1 Might, but this card never
 *   places one).
 *
 * Status: judge-required — the layers path still cannot evaluate this gate, so
 * binding the card would apply +1 Might unconditionally:
 * - packages/engine-core/src/layers/engine.ts evaluates a registered
 *   ContinuousEffectSpec through matchesObjectFilter + conditionMatches, and
 *   conditionMatches only understands always/never/type/has-tag/has-keyword; it
 *   returns true for every other Condition shape including compare/count, so the
 *   "another unit here" gate cannot be honestly expressed on the layer path.
 * - layers/filter.ts matchesObjectFilter implements no `sameLocationAs`/`exclude`
 *   anchor either (the interpreter's queryObjects implements both, and the golden
 *   executes the gate through the interpreter to prove the declared shape is
 *   right), so the layer-side anchor is missing.
 * - No merged consumer reads a card-program static ability's amount or registers
 *   it into the layers: programs/lifecycle.ts calls the injected `bindStatic`, and
 *   the default binder in programs/statics.ts is `noopStaticBinder` (RIFT-257
 *   follow-up).
 * Dependencies: layer-side condition/anchor evaluation plus card-static
 * registration (RIFT-91 follow-up / RIFT-257 follow-up). The declared static
 * effect below records the intended shape; nothing is approximated and no Buff is
 * placed.
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
    // "While you have another unit here" — 355.9.c excludes the source and
    // 359.3.f anchors "here" to the source's location. The interpreter evaluates
    // this condition exactly (golden evidence); the layer engine's conditionMatches
    // does not (see judgeReason).
    condition: {
      kind: "compare",
      left: {
        kind: "count",
        subject: "other-units-here",
        filter: {
          zone: "board",
          type: "unit",
          controller: "self",
          exclude: "self",
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
    "图层侧门槛仍不可求值，直接绑定会把 +1 变成无条件：(1) layers/engine.ts 的 conditionMatches 只识别 always/never/type/has-tag/has-keyword，" +
    "其余 Condition（含 compare/count）一律返回 true——「While you have another unit here」在图层路径上无诚实求值；" +
    "(2) layers/filter.ts 的 matchesObjectFilter 也没有实现 sameLocationAs/exclude 锚点（解释器的 queryObjects 已实现两者，golden 用解释器真实执行该条件以证明声明形状正确，" +
    "但图层路径缺这两个锚点）；(3) 没有已合入消费方读取卡牌 static 能力的 amount 或把它注册进图层：programs/lifecycle.ts 调用的 bindStatic 默认是 programs/statics.ts 的 noopStaticBinder" +
    "（RIFT-257 后续）。已按 143.2.a/475–478 声明为 arithmetic 层 static continuous.might：+1 是静态 Might 修正，绝不用 702 的 Buff 计数器近似（本卡不放置 Buff）。" +
    "依赖：图层条件（compare/count 与 sameLocationAs/exclude）与卡牌 static 注册（RIFT-91 后续 / RIFT-257 后续）。不近似实现。",
  abilities,
  sourceText: "While you have another unit here, I have +1 :rb_might:."
} satisfies CardProgram;

export default program;

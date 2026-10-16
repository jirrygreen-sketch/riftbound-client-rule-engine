import type { CardProgram } from "../../ir/index.js";

/**
 * Gemcraft Seer (ogn-100-298) — Unit, 3 energy + 1 Power, 3 Might, Mind,
 * Mount Targon.
 *
 * Printed text:
 *   [Vision] (When you play me, look at the top card of your Main Deck. You
 *   may recycle it.)
 *   Other friendly units have [Vision].
 *
 * Status: judge-required.
 * - [Vision] (817.1.b/c) is merged (effects/keywords/Vision.ts) and its Predict
 *   steps run through the interpreter + reference kernel (golden test).
 * - "Other friendly units have [Vision]" is a static ability-layer keyword
 *   grant (contract 3.4/3.7: continuous effects never enter the chain). The
 *   merged layers engine understands a `grant-keyword` ability effect
 *   (layers/engine.ts applyAbility), but nothing turns a card program's static
 *   ability into a registered continuous effect: no card-program adapter calls
 *   layerEngine.addContinuous, so the grant has no consumer. "Other" also needs
 *   the source excluded, which no merged static-effect plumbing expresses.
 *   Not approximated (a SelfScope Vision re-declaration would double-count
 *   Vision, contrary to 817.2).
 *
 * The grant filter follows the merged static-grant spelling used by the same
 * family ("Your Mechs have [Vision]", cards/sfd/forecaster.ts): `controller`
 * is the ability-controller placeholder resolved by the (unmerged) continuous
 * effect consumer, and `exclude: "self"` is the merged ObjectSelector anchor
 * for "other" (contract 3.6 selector shape, interpreter queryObjects).
 */
export default {
  canonicalCardId: "card.hash-636736b78f865097117f9cc183f462f662d5b234a87f487fd261ac54279875c6",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「Other friendly units have [Vision]」需要把卡牌程序的静态能力注册进图层引擎的 continuous 效果（applyAbility 已能处理 grant-keyword，" +
    "但没有任何卡牌程序适配器调用 layerEngine.addContinuous），且需要把本卡自身从授予集合中排除（817.2 下重复 Vision 会各自触发，不能近似成再声明一次 keyword）。" +
    "依赖：RIFT-91（layers-continuous）及卡牌程序→持续效果的注册适配。[Vision]（817）本体已合入并可在参考内核执行。不近似实现。",
  abilities: [
    { kind: "keyword", keyword: "vision" },
    {
      kind: "static",
      effect: {
        kind: "grant-keyword",
        keyword: "vision",
        filter: {
          type: "unit",
          controller: "controller",
          zone: "board",
          exclude: "self"
        }
      }
    }
  ],
  sourceText:
    "[Vision] (When you play me, look at the top card of your Main Deck. You may recycle it.)\n" +
    "Other friendly units have [Vision]."
} satisfies CardProgram;

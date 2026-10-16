import type { CardProgram } from "../../ir/index.js";

/**
 * Sigil of the Storm (ogn-287-298) — Battlefield, Colorless.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, ogn-287-298):
 *   "When you conquer here, recycle one of your runes."
 *
 * CR v1.5 anchors:
 * - 383.4.c / 383.4.c.1: "When you conquer here …" is a Conquer Effect — a
 *   Triggered Ability whose Condition includes the player conquering that
 *   Battlefield; the closed `conquer` timing point (468.5.d, 471.1, 473.2.a)
 *   is the one scoring/ is meant to emit.
 * - 417.1.b: runes are Recycled to the Rune Deck; 417.1.c: each player recycles
 *   to their own deck. 417.4: a recycle effect recycles as many as possible, so
 *   an empty rune zone is a successful no-op rather than a failure.
 * - 417.6: "Recycle X from [Zone]" is the non-targeting form — the instructed
 *   player takes X cards of their choice from the zone ("one of your runes"),
 *   so the ability carries no TargetSpec; effect.recycle's `from` form with
 *   the default owner (the ability controller) implements it.
 *
 * Status: judge-required — the body only uses the merged effect.recycle
 * primitive (and is executed by the golden test), but no merged module emits
 * the `conquer` timing point into the single event pipeline, so the trigger
 * cannot run in production (see judgeReason).
 */
const sigilOfTheStorm = {
  canonicalCardId: "card.hash-99269cca1e28890ac67140558b99391b7697d84d62ce158a0946bed6920daedd",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺时点接线：\"When you conquer here\" 依赖 conquer 时点（CR 383.4.c.1、471.1、473.2.a）进入唯一事件管线，" +
    "但已合入代码没有任何模块 emit conquer（scoring/scoring.ts 只产出 DuelScoreOutcome，未接入 events/ 管线；" +
    "chain/engine.ts 亦不产生该节点），SCENARIO-COVERAGE.md 的 triggers-conquer-unit-present 与 " +
    "triggers-conquer-point-replaced-still-triggers 均标注未覆盖（470.1：得分被替代时征服效果仍触发），" +
    "需 scoring/触发接线任务（RIFT-31 scenarios-scoring / RIFT-33 scenarios-triggers 及契约 §7.2 批 5）；" +
    "触发器 filter 里的 here=true 是等待 scoring 载荷的占位键，引擎侧 assertTriggerSpec 同样拒绝它" +
    "（golden 测试断言了这一点）。能力本体只用已合入的 effect.recycle " +
    "（from: rune-zone，默认 owner 为能力控制者，即 “your runes”），不近似实现。",
  sourceText: "When you conquer here, recycle one of your runes.",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "conquer",
        filter: { event: "conquer", here: true, player: "controller" }
      },
      optional: false,
      body: [
        {
          id: "sigil.recycle-one-rune",
          op: "effect.recycle",
          args: {
            // "one of your runes": 417.6 non-targeting form. The default owner
            // is the ability controller, and the primitive recycles as many as
            // possible (417.4) when fewer runes are on the board.
            from: {
              kind: "constant",
              value: {
                zone: "rune-zone",
                amount: { kind: "constant", value: 1 }
              }
            }
          }
        }
      ]
    }
  ]
} satisfies CardProgram;

export default sigilOfTheStorm;

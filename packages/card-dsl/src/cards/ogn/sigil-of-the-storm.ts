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
 * primitive (and is executed by the golden test), and the `conquer` timing
 * point is now emitted by the Score wave in turn/flow.ts. The trigger itself
 * still cannot be expressed: the EventPattern vocabulary has no battlefield-
 * relative "here" key, and the payload's details.battlefieldId is never
 * compared with the source's current location by any merged host (see
 * judgeReason).
 */
const sigilOfTheStorm = {
  canonicalCardId: "card.hash-99269cca1e28890ac67140558b99391b7697d84d62ce158a0946bed6920daedd",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「here」无法诚实表达：conquer 时点与计分波已由 turn/flow.ts 的 Score 波（emissions.push({ timingPoint: score.method ... })，" +
    "约 95-104 行）发出并进链（471.1、473.2.a，" +
    "RIFT-124/262 已合入），但 EventPattern 词汇（events/trigger-spec.ts）没有战场相对键，" +
    "任何已合入 host 也没有把载荷 details.battlefieldId 与来源当前位置比较；" +
    "现有 filter 的 here=true 是等待该语义的占位键，引擎侧 assertTriggerSpec 会拒绝它（unknown-field；" +
    "event \"conquer\" 与 player \"controller\" 也不是封闭拼写，golden 断言了这一点）。" +
    "SCENARIO-COVERAGE.md 的 triggers-conquer-unit-present 与 triggers-conquer-point-replaced-still-triggers " +
    "仍标注未覆盖（470.1：得分被替代时征服效果仍触发）。能力本体只用已合入的 effect.recycle " +
    "（from: rune-zone，默认 owner 为能力控制者，即 “your runes”），golden 真实执行，不近似实现。" +
    "依赖：EventPattern 的「here」语义与 host 侧比较（RIFT-120 触发工作流）。",
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

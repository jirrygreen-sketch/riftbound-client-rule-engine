import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Sandshifter (sfd-158-221) — Unit, 5 energy + 2 Order power, Might 6, tag Shurima.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, sfd-158-221):
 *   When you play me, kill an enemy unit with 3 :rb_might: or less.
 *
 * Rules evidence (Core Rules v1.5):
 * - "When you play me" is a Play Effect (383.4.a, 383.4.a.1): the card-played
 *   timing point filtered to this card.
 * - "kill an enemy unit with 3 :rb_might: or less" names one specific game
 *   object in a public zone, so it is a Target (355.7, 355.9.a, 355.10.a);
 *   355.9.b gives "a unit with Might 4 or greater" as its own example of a
 *   Might-threshold targeting restriction, and 2047 notes that a unit with 3
 *   or less Might stops being a legal target when it stops being a unit. The
 *   ceiling is re-checked at Finalize and Resolve (359.3.e.2).
 * - effect.kill submits the merged kill action (429.1) and the engine owns
 *   kill attribution (429.5) and the object-killed timing point.
 *
 * Status: judge-required — the target's Might ceiling cannot be evaluated by
 * merged code, and nothing is approximated:
 * - the frozen ObjectFilter has no Might predicate, and no merged consumer
 *   reads one: the layer filter (packages/engine-core/src/layers/filter.ts)
 *   matches only objectId/cardId/type/zone/location/controller/owner/states/
 *   tags/characteristics, and the reference kernel filter matches only
 *   type/types/tag/tags/controller/owner/zone/location. An unknown key such as
 *   the descriptive mightLte below is silently ignored, which would let
 *   Sandshifter kill ANY enemy unit; requiring 143.2.a effective-Might reads
 *   plus a threshold predicate (condition.predicate / target query) belongs to
 *   the keyword/layer batches.
 * Dependencies: RIFT-81~91 (Mighty-style Might predicate support behind filter
 * evaluation) and the RIFT-32/33 layer + target-query scenarios. The body
 * instruction is the merged effect.kill primitive and is executed against a
 * Finalize-locked target in the golden test.
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "card-played",
      filter: { event: "card-played", filter: { source: "self" } }
    },
    optional: false,
    body: [
      {
        id: "sandshifter.kill-weak-enemy",
        op: "effect.kill",
        args: {
          target: { kind: "constant", value: "sandshifter.weak-enemy-unit" }
        },
        targets: [
          {
            id: "sandshifter.weak-enemy-unit",
            // Descriptive ceiling only: 355.9.b / 143.2.a. No merged target or
            // layer filter evaluates this key, so it must never be treated as
            // a working restriction (see judgeReason).
            filter: { type: "unit", zone: "board", controller: "opponent", mightLte: 3 },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-6c5e86a11835553c21b709846a47353de46fcea93be21041ecaf6f4a50b1ecd7",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "缺“Might 上限”目标过滤：冻结的 ObjectFilter 没有 Might 谓词，已合入的过滤器（layers/filter.ts 的 matchesObjectFilter、测试内核的 matchesFilter）" +
    "只按 type/zone/controller/tags/characteristics 等字段匹配，未知键（如程序里的 mightLte）会被静默忽略——" +
    "把它当已实现会让 Sandshifter 能消灭任意敌方单位；355.9.b 的「单位 Might ≥ 4」类限制需要 143.2.a 的有效 Might 读取与阈值谓词。" +
    "effect.kill 本体（429.1/429.6）已合入，golden 用锁定目标真实执行 kill；整卡因阈值过滤保持 judge-required，不近似实现。" +
    "依赖：RIFT-81~91（Mighty 类 Might 谓词/过滤）、RIFT-32/33（图层与目标查询场景）。",
  abilities,
  sourceText: "When you play me, kill an enemy unit with 3 :rb_might: or less."
} satisfies CardProgram;

export default program;

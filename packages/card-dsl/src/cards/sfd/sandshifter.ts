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
 * merged code, and nothing is approximated. Re-checked after the RIFT-257..270
 * batches:
 * - the frozen ObjectFilter still has no Might predicate, and no merged consumer
 *   reads one: layers/filter.ts matches objectId/cardId/type/zone/location/
 *   controller/owner/states/tags/characteristics, and the reference kernel
 *   filter matches only type/types/tag/tags/controller/owner/zone/location.
 *   characteristics is an equality-only bag (characteristics: { might: 3 }
 *   matches exactly 3), so it cannot express "3 or less".
 * - an unknown key such as the descriptive mightLte below is silently ignored by
 *   both filters (verified: querying { mightLte: 3 } returns every unit, including
 *   a 6-Might one), which would let Sandshifter kill ANY enemy unit. The Mighty
 *   keyword (RIFT-81) exposes a threshold predicate for its own expansion, but
 *   nothing feeds an effective-Might threshold (143.2.a) into target filtering,
 *   and programs/filters.ts rejects the unknown field anyway
 *   ("Unsupported filter field mightLte"), so the card cannot be bound either.
 * Dependencies: an effective-Might comparison predicate behind ObjectFilter
 * evaluation plus the target-query consumer (the Mighty/layer batches and the
 * RIFT-32/33 layer + target-query scenarios). The body instruction is the merged
 * effect.kill primitive and is executed against a Finalize-locked target in the
 * golden test.
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
    "缺「Might 上限」目标过滤：冻结的 ObjectFilter 仍没有 Might 比较谓词，已合入的过滤器（layers/filter.ts 的 matchesObjectFilter、" +
    "测试内核的 matchesFilter）只按 type/zone/controller/tags/characteristics 等字段匹配；characteristics 是等值匹配（{ might: 3 } 只命中恰好 3），" +
    "表达不了「3 或以下」；未知键（如程序里的 mightLte）被两个过滤器静默忽略（实测：{ mightLte: 3 } 会返回包括 6 Might 单位在内的所有单位），" +
    "把它当已实现会让 Sandshifter 能消灭任意敌方单位（355.9.b 的「单位 Might ≥ 4」类限制正是同一类阈值；143.2.a 的 Might 指有效 Might）。" +
    "RIFT-81 的 Mighty 只给它自己的展开暴露阈值谓词，没有任何消费方把有效 Might 阈值" +
    "接进目标过滤；programs/filters.ts 也会直接拒绝该字段（Unsupported filter field mightLte），卡牌因此无法绑定。" +
    "effect.kill 本体（429.1/429.6）已合入，golden 用锁定目标真实执行 kill；整卡因阈值过滤保持 judge-required，不近似实现。" +
    "依赖：ObjectFilter 上的有效 Might 比较谓词与目标查询消费方（Mighty/图层批次、RIFT-32/33 图层与目标查询场景）。",
  abilities,
  sourceText: "When you play me, kill an enemy unit with 3 :rb_might: or less."
} satisfies CardProgram;

export default program;

import type { CardProgram } from "../../ir/index.js";

/**
 * Gust (ogn-169-298) — Spell, 1 energy, Chaos.
 *
 * Printed text:
 *   [Reaction] (Play any time, even before spells and abilities resolve.)
 *   Return a unit at a battlefield with 3 :rb_might: or less to its owner's hand.
 *
 * Structure (contract 3.1 / 3.2, Core Rules v1.5):
 * - `reaction` keeps the printed [Reaction] keyword (813; spell intrinsic timing
 *   159.2.b); its expansion and the chain admission belong to the keyword
 *   registry and chain/ (contract 3.7).
 * - "Return a unit … to its owner's hand" moves a Board object to Hand. The
 *   unit is a target (355.10.a / 355.9.a.1: "unit" is a Board object, and
 *   choosing it is a choice, not a characteristic query), so the instruction is
 *   `effect.zone` with a TargetSpec and `to: "hand"`; the action layer routes
 *   the card to its OWNER's hand, not the caster's (359.3.e.9 example: 2142
 *   "returns the friendly unit to its owner's hand").
 * - "at a battlefield" is a targeting restriction on the unit, not a second
 *   target (355.10.b); it is recorded as `location: "battlefield"`, the frozen
 *   ObjectFilter Location spelling (events/trigger-spec.ts `location?: string`,
 *   layers/filter.ts accepts the location name or the exact Location).
 *
 * Status: judge-required — the "with 3 :rb_might: or less" restriction has no
 * executable predicate. Targets are finalized from static `ObjectFilter` data
 * (target/target-plan.ts), and neither the filter vocabulary nor the frozen IR
 * offers a numeric comparison on a unit's current Might (the Mighty threshold
 * predicate is the closest thing and is itself unmerged: keywords/Mighty.ts
 * expands a descriptive `condition.value` static effect, layers are RIFT-91,
 * keyword expansion is RIFT-83). The `mightLte: 3` field below is descriptive
 * only and is not consumed by any merged layer or target check; no approximate
 * Might test (e.g. counting objects) is substituted. The Move half itself uses
 * only the merged effect.zone primitive and is executed in the golden test.
 */
const gust = {
  canonicalCardId: "card.hash-22baca2d2ee27d8cf7c15a3d1d1f215e8c0a3b8fbbe9b0edcd70d888b29a21d5",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺「Might 3 或更少」的目标限制谓词：目标合法性只由静态 ObjectFilter / TargetRequirement 在 Finalize 求值（target/target-plan.ts），" +
    "冻结的 IR 与过滤器词表都没有对当前 Might 的数值比较（最接近的 [Mighty] 阈值本身依赖 RIFT-83 的关键词展开与 RIFT-91 的图层求值）；" +
    "本文件里的 mightLte: 3 只是描述、无消费方，不用计数或等价近似替代。Return 半段只用已合入的 effect.zone 表达并有执行测试。",
  abilities: [
    { kind: "keyword", keyword: "reaction" },
    {
      kind: "play",
      body: [
        {
          id: "gust.return-unit",
          op: "effect.zone",
          args: {
            target: { kind: "constant", value: "gust.unit-at-battlefield" },
            to: { kind: "constant", value: "hand" },
            amount: { kind: "constant", value: 1 }
          },
          targets: [
            {
              id: "gust.unit-at-battlefield",
              filter: {
                type: "unit",
                zone: "board",
                location: "battlefield",
                // 描述性占位：见 judgeReason，尚无 Might 比较谓词。
                mightLte: 3
              },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ],
  sourceText:
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "Return a unit at a battlefield with 3 :rb_might: or less to its owner's hand."
} satisfies CardProgram;

export default gust;

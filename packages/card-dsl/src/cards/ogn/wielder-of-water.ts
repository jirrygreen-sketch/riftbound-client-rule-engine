import type { CardProgram } from "../../ir/index.js";

/**
 * Wielder of Water (ogn-055-298) — Unit, 3 energy, Might 2, Calm, Ionia.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, ogn-055-298):
 *   While I'm attacking or defending alone, I have +2 :rb_might:.
 *
 * Rules evidence (Core Rules v1.5):
 * - The text is a Conditional Passive Ability, recognized by "while" and
 *   taking the exact form the rules use as their example (364.3, 364.3.a);
 *   passive abilities of permanents are active while on the Board (365.1).
 * - Being alone is defined by 740.2.a: a unit is alone when there are no other
 *   friendly units at the same location. The printed ability applies while the
 *   unit is attacking or defending (rule 461, the Attacker/Defender
 *   designations) — mixed with the "alone" predicate.
 * - Contract 3.7 expands static abilities as data consumed by the layers
 *   engine outside the chain (contract 3.4). This program declares the
 *   intended continuous.might effect with an arithmetic layer, +2, appliesTo
 *   self and a duration matching the ability's own presence.

 * Status: judge-required. The conditional Might modification cannot be
 * executed by the merged code:
 * - the continuous.might instruction primitive (RIFT-258) is merged, but no
 *   merged code turns a card program's static ability into a registered
 *   continuous effect (RIFT-257 card-program binding); and
 * - the ability's condition needs two characteristics the merged layer path
 *   cannot read: contract 3.8 `combatRole` is now in effects/contract.ts, but
 *   layers/engine.ts `conditionMatches` still only recognizes
 *   always/never/type/has-tag/has-keyword and evaluates anything else as true
 *   (so a naive registration would apply +2 Might unconditionally), and the
 *   "alone" predicate (740.2.a) needs a location-relative count of other
 *   friendly units — layers/filter.ts implements no sameLocationAs anchor
 *   (verified: it matches objects at any location).
 * Dependencies: RIFT-257, the layers condition evaluator's combatRole/alone
 * support. Not approximated.
 */
export default {
  canonicalCardId: "card.hash-2cbbc0b067da2370a522b50188aead6aa06a594259be55b5951e6f51601e59ef",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「While I'm attacking or defending alone, I have +2 [M]」（364.3.a 的条件被动、740.2.a 的 alone）不可执行：" +
    "continuous.might 指令（RIFT-258）已合入，但没有任何合入路径把卡牌程序的 static ability 注册进 layers（RIFT-257；" +
    "ResolveContext.addContinuous 目前只被原语调用）；条件还要读两个合并图层路径没有的能力：" +
    "攻防身份（契约 3.8 的 ObjectSnapshot.combatRole 已在 effects/contract.ts，但 layers/engine.ts 的 conditionMatches " +
    "仍只识别 always/never/type/has-tag/has-keyword，其它条件一律按 true 处理，草率注册会把 +2 Might 无条件套用）" +
    "与「同位置无敌方/友方单位」的 alone 谓词（740.2.a；layers/filter.ts 不实现 sameLocationAs 锚点，实测会匹配任意位置）。" +
    "依赖：RIFT-257 与图层条件求值器的 combatRole / alone 支持。不近似实现。",
  abilities: [
    {
      kind: "static",
      effect: {
        kind: "continuous.might",
        mode: "add",
        layer: "arithmetic",
        appliesTo: "self",
        amount: { kind: "constant", value: 2 }
      },
      condition: {
        kind: "all",
        conditions: [
          {
            // "I'm attacking or defending": the merged IR has no combat-role
            // characteristic yet (contract 3.8 combatRole); this names the
            // intended predicate for the layers consumer.
            kind: "expression",
            value: { kind: "constant", value: "self-in-combat-as-attacker-or-defender" }
          },
          {
            // "alone": no other friendly unit at the same location (740.2.a).
            kind: "compare",
            left: {
              kind: "count",
              subject: "objects",
              filter: {
                type: "unit",
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
  ],
  sourceText: "While I'm attacking or defending alone, I have +2 :rb_might:."
} satisfies CardProgram;

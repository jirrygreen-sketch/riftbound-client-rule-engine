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
 * - the closed GameAction set of contract 3.6 has no Might-modification
 *   action, and effect.buff documents that temporary Might changes belong to a
 *   layers `continuous.might` consumer, never to the Buff counter primitive
 *   (Buff is a +1 Might counter with one per unit, 702.3/703 — a different
 *   object);
 * - no merged code turns a card program's static ability into a registered
 *   continuous effect, and the ability's condition needs two characteristics
 *   the merged IR cannot read: the attacker/defender designation (contract 3.8
 *   `combatRole`, not present in engine-core's effects/contract.ts) and the
 *   "alone" predicate (740.2.a), which needs a location-relative count of
 *   other friendly units (contract 3.8 adds HistoryQuery.objectFilter but the
 *   layers filter has no such predicate).
 * Dependencies: RIFT-91 (layers-continuous), plus the combat designation
 * field of contract 3.8 and the lone-unit predicate. Not approximated.
 */
export default {
  canonicalCardId: "card.hash-2cbbc0b067da2370a522b50188aead6aa06a594259be55b5951e6f51601e59ef",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「While I'm attacking or defending alone, I have +2 [M]」（364.3.a 的条件被动、740.2.a 的 alone）不可执行：" +
    "契约 3.6 封闭 GameAction 无 Might 修改动作，effect.buff 明确临时 Might 修改归 layers 的 continuous.might（Buff 是 702.3/703 的 +1 Might 计数器，每单位限一个，不是同一语义）；" +
    "且没有任何合入路径把卡牌程序的 static ability 注册进 layers（RIFT-91），条件还要读两个合并 IR 没有的特征：" +
    "攻防身份（契约 3.8 的 ObjectSnapshot.combatRole，engine-core effects/contract.ts 尚无该字段）与「同位置无敌方/友方单位」的 alone 谓词（740.2.a）。" +
    "依赖：RIFT-91（layers-continuous）与 combatRole / lone 谓词落地。不近似实现。",
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

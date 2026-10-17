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
 * - "attacking or defending" has a real execution path: the merged contract
 *   3.8 combatRole characteristic is on ObjectSnapshot and the static binder's
 *   abilityEnvironment (programs/statics.ts) evaluates Condition IR through
 *   the merged effects/interpreter. The count half cannot follow it: 740.2.a
 *   counts only other *friendly* units, and the static binder's count query
 *   resolves non-anchor fields through layers/filter.ts matchesObjectFilter,
 *   whose selectorMatches passes the candidate unit's own controller as the
 *   owner comparison value (filter.ts:62) — `controller: "self"` therefore
 *   matches every candidate at the location instead of only friendlies and
 *   `controller: "opponent"` matches none (the hand-authored expression
 *   constant and the old missing-sameLocationAs note are obsolete).
 *
 * Status: judge-required. The condition is compiled into a real predicate by
 * the static binder and the continuous.might arithmetic layer is merged, but
 * the 740.2.a friendly-only count has no correct static path; approximating
 * it (dropping the controller key) would count enemies and misread the rule.
 * Dependencies: a relative-controller (ability-source) query path for static
 * count conditions, or 740.2.a support in the static binder's condition
 * evaluation. Not approximated.
 */
export default {
  canonicalCardId: "card.hash-2cbbc0b067da2370a522b50188aead6aa06a594259be55b5951e6f51601e59ef",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「While I'm attacking or defending alone, I have +2 [M]」（364.3.a 的条件被动）不可执行：" +
    "攻防半段已可执行——契约 3.8 的 ObjectSnapshot.combatRole 已合入，static binder 的 abilityEnvironment " +
    "（programs/statics.ts）通过 effects/interpreter 真实求值 Condition；旧理由里的 expression 常量与 " +
    "sameLocationAs 缺口已过时。当前真实缺口是 740.2.a 的 alone 只统计同位置的其他友好单位：" +
    "static binder 的 count 查询把非锚点字段交给 layers/filter.ts 的 matchesObjectFilter，其 selectorMatches " +
    "以候选单位自己的 controller 作为 owner 比较值（filter.ts:62），controller:\"self\" 对同位置所有候选恒真、" +
    "controller:\"opponent\" 恒假，「仅友方」计数无正确执行路径。依赖：static 条件查询的相对 controller " +
    "（能力来源）解析，或 740.2.a 的专用 static 求值支持。不近似实现。",
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
            // "I'm attacking or defending": contract 3.8 stores the merged
            // Attacker/Defender designation (461) on ObjectSnapshot.combatRole;
            // the merged interpreter compares it with the real `in` operator.
            kind: "compare",
            left: {
              kind: "object-property",
              object: "self",
              property: "combatRole"
            },
            operator: "in",
            right: { kind: "constant", value: ["attacker", "defender"] }
          },
          {
            // "alone": no other friendly unit at the same location (740.2.a);
            // the count keeps the rule's friendly scope via controller:
            // "self", which the static binder cannot resolve correctly yet
            // (see the status note above).
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

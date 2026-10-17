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
    "2026-10-17 复核（逐条实测）：" +
    "(1) 攻防半段的生产路径已通：契约 3.8 的 ObjectSnapshot.combatRole 已合入，static binder 的 " +
    "abilityEnvironment（programs/statics.ts）经 effects/interpreter 真实求值 Condition；参考内核里 " +
    "combatRole:\"attacker\" 的单独单位实测得 Might 4。" +
    "(2) 通用卡牌测试台（packages/engine-core/src/effects/testing/scenario/）的 objectConfig 不搬运 " +
    "ObjectSnapshot.combatRole，场景里的宿主永远不在战斗中，因此本卡的攻防半段无法经测试台真实路径覆盖。" +
    "(3) 740.2.a 的 alone 仍无正确 static 路径：static binder 的 count 查询把非锚点字段交给 " +
    "layers/filter.ts 的 matchesObjectFilter，其 selectorMatches 以候选单位自己的 controller 作为 " +
    "owner 比较值（filter.ts:62），controller:\"self\" 对同位置所有候选恒真、controller:\"opponent\" " +
    "恒假（实测同位置的敌方单位会被当成友方）。依赖：static 条件查询的相对 controller（能力来源）解析，" +
    "或 740.2.a 的专用 static 求值支持；以及测试台对 combatRole 的搬运。不近似实现。",
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
            // The count keeps the rule's friendly scope via controller:
            // "self"; the static binder's filter matcher still compares the
            // candidate against its own controller (see judgeReason), so the
            // friendly-only scope has no correct execution path yet.
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

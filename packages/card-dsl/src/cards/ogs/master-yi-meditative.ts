import type { CardProgram } from "../../ir/index.js";

/**
 * Master Yi, Meditative (ogs-004-024).
 * CR v1.5 143.2/478.1.a: +4 Might is an arithmetic-layer static effect.
 * Channeled runes remain in the rune zone (133.5.a.1, 161.1.a, 431.1).
 * The static binder evaluates conditions, but its count query still passes
 * controller: "controller" to an absolute-player layer filter. That relative
 * player binding is the remaining gap; event-trigger adapters are irrelevant
 * to this Passive Ability. Keep judge-required until the original condition
 * can count the host controller's runes through the production static binder.
 */
export default {
  canonicalCardId: "card.hash-87c4e90c814243a78c356216704a1ec163c6f16ccaba9de6697847335b8f6601",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "continuous.might 的静态条件仍缺相对控制者绑定：programs/statics.ts abilityEnvironment 的 count 查询把 filter.controller: \"controller\" 原样传给 layers/filter.ts matchesObjectFilter，与实际玩家 ID 不匹配，8+ runes 被计为 0。需在静态条件查询中按能力来源解析 controller，并排除对手符文（CR 133.5.a.1/431.1/143.2）；契约变更请求。",
  abilities: [
    {
      kind: "static",
      effect: {
        kind: "continuous.might",
        mode: "add",
        layer: "arithmetic",
        appliesTo: { kind: "constant", value: "self" },
        amount: { kind: "constant", value: 4 }
      },
      condition: {
        kind: "compare",
        left: {
          kind: "count",
          subject: "runes",
          filter: { type: "rune", controller: "controller", zone: "rune-zone" }
        },
        operator: "gte",
        right: { kind: "constant", value: 8 }
      }
    }
  ],
  sourceText: "While you have 8+ runes, I have +4 :rb_might:."
} satisfies CardProgram;

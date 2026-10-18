import type { CardProgram } from "../../ir/index.js";

/**
 * Yasuo, Remorseful (ogn-076-298).
 * CR v1.5 383.4.e.1-383.4.e.2.a: first attacker designation per combat.
 * CR 418 / 740.1.b: damage uses the source's current Might and targets one enemy here.
 * No printed-Might constant, manual damage action, or single-card resolver is used.
 * The dynamic amount, the once-per-combat trigger scope and the interpreter's
 * source-location query anchor are merged and exercised by the golden tests; the
 * remaining production gaps are recorded below.
 *
 * Re-checked 2026-10-17: the authored attack filter now uses source:self,
 * which the production translator binds to the actual host. Remaining gaps:
 * - target binding rejects sameLocationAs; the DSL target validator also
 *   rejects the relative location selectors accepted by target/location;
 * - the raw ResolveContext query does not apply the relative location anchor;
 * - combat/flow.ts has no atomic first-Attacker designation event producer.
 * The original body is tested with both a legal here target and that target
 * moving away before Resolve; the card remains judge-required.
 */
const program = {
  canonicalCardId: "card.hash-751e2b1c16ab2529b3d0bf37e5309cfde9a7b41589d08799cf53a9a8ef42e5e8",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺 an enemy unit here 的生产目标绑定（CR 740.1.b）：programs/filters.ts 拒绝 sameLocationAs，" +
    "抛 Unsupported filter field sameLocationAs；IR validateTarget 未接 target/location 的相对位置选择器，" +
    "source-location / location-of 被判 invalid-location-filter / invalid-location-kind。" +
    "bindResolveContext 的原始 query 也忽略 sameLocationAs，只有解释器内部 queryObjects 应用锚点。" +
    "combat/flow.ts 还在首次攻击身份与同时伤害事务抛 TurnCombatBlockedError，" +
    "缺 CR 383.4.e 的首次 Attacker designation → attack-declared 生产链路。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "attack-declared",
        filter: { event: "attack-declared", source: "self" },
        once: "per-combat"
      },
      optional: false,
      body: [
        {
          id: "deal-might",
          op: "effect.damage",
          args: {
            amount: {
              kind: "object-property",
              object: "source",
              property: "might"
            },
            target: {
              kind: "constant",
              value: "enemy-here"
            }
          },
          targets: [
            {
              id: "enemy-here",
              filter: {
                type: "unit",
                zone: "board",
                controller: "opponent",
                sameLocationAs: "source"
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
  sourceText: "When I attack, deal damage equal to my Might to an enemy unit here."
} satisfies CardProgram;

export default program;

import type { CardProgram } from "../../ir/index.js";

/**
 * Fiora, Peerless (sfd-110-221) — fiora-sfd (RIFT-95).
 *
 * "When I attack or defend one on one, double my Might this combat."
 *
 * Triggered on attack-declared and defense-declared (trigger.combat family),
 * gated by the one-on-one predicate (CR 740.2.b: a unit is one on one when
 * it and the enemy unit at the same location are both alone). The effect
 * doubles Might for the combat (continuous.might with a combat duration).
 */
export default {
  canonicalCardId: "card.hash-6bde2e2c542ff8fc1a7a2f9204df7e6c58a05a53ad98c0a31d69927be053b77f",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "Depends on the one-on-one predicate (CR 740.2.b) as a condition, the attack-declared/defense-declared trigger filter, and a continuous.might doubling effect with an end-of-combat duration; none of these have merged layers/predicate/duration support. Not approximated per the judge-required rule.",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "attack-declared",
        filter: {
          event: "attack-declared",
          filter: { source: "self" }
        },
        condition: {
          kind: "expression",
          value: { kind: "constant", value: "one-on-one" }
        },
        once: "per-combat"
      },
      optional: false,
      body: [
        {
          id: "double-might-attack",
          op: "effect.buff",
          args: {
            mode: { kind: "constant", value: "buff" },
            target: { kind: "constant", value: "self" }
          }
        }
      ]
    },
    {
      kind: "triggered",
      trigger: {
        at: "defense-declared",
        filter: {
          event: "defense-declared",
          filter: { source: "self" }
        },
        condition: {
          kind: "expression",
          value: { kind: "constant", value: "one-on-one" }
        },
        once: "per-combat"
      },
      optional: false,
      body: [
        {
          id: "double-might-defend",
          op: "effect.buff",
          args: {
            mode: { kind: "constant", value: "buff" },
            target: { kind: "constant", value: "self" }
          }
        }
      ]
    }
  ],
  sourceText: "When I attack or defend one on one, double my Might this combat."
} satisfies CardProgram;

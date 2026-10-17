import type { CardProgram } from "../../ir/index.js";

/**
 * Wizened Elder (ogn-065-298) — Unit, 4 energy, 1 Calm power, Might 4, Ionia.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, ogn-065-298):
 *   While I'm buffed, I have an additional +1 :rb_might:.
 *
 * Rules evidence (Core Rules v1.5):
 * - The text is a Conditional Passive Ability recognized by "while" (364.3,
 *   364.3.a); passive abilities of permanents are active while on the Board
 *   (365.1).
 * - "buffed" is defined by 702.2.a: a unit is Buffed for as long as the buff
 *   remains on it, and each Buff contributes +1 Might individually (703). The
 *   printed ability adds one further, separate +1 Might on top of that.
 * - 702.3 / 702.3.a: at most one Buff per unit, so ObjectFilter.characteristics
 *   { buffs: 1 } is the exact "buffed" predicate.
 *
 * Status: executable. The static-program binder resolves the host identity and
 * preserves the `characteristics.buffs` filter in a ContinuousEffectSpec;
 * layers/filter.ts re-evaluates that filter as Buff state changes. The +1 is a
 * separate arithmetic Might modification, never a second Buff counter.
 */
export default {
  canonicalCardId: "card.hash-16335e499c8dc3283d678e27bfe613e02ef16a6babfe209f953b1959c52fd375",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    {
      kind: "static",
      effect: {
        kind: "continuous.might",
        mode: "add",
        layer: "arithmetic",
        amount: { kind: "constant", value: 1 },
        // "While I'm buffed" (702.2.a; 702.3 caps at one Buff): the merged
        // evaluable predicate spelling. layers/filter.ts characteristicsMatch
        // reads it on every evaluation, so the gate follows Buff gain/spend.
        filter: {
          object: "self",
          type: "unit",
          zone: "board",
          characteristics: { buffs: 1 }
        }
      }
    }
  ],
  sourceText: "While I'm buffed, I have an additional +1 :rb_might:."
} satisfies CardProgram;

import type { CardProgram } from "../../ir/index.js";

/**
 * Wages of Pain — sfd-070-221 (Spell, Mind, Rumble SFD champion precon).
 *
 * Printed text:
 *   [Hidden] (Hide now for [A] to react with later for [0].)
 *   [Action] (Play on your turn or in showdowns.)
 *   Deal 3 to a unit at a battlefield. Play a Gold gear token exhausted.
 *
 * Modeling notes (Core Rules v1.5):
 * - [Hidden] (811) / [Action] (806) are keyword abilities expanded by the
 *   keyword registry (contract 3.7).
 * - "Deal 3 to a unit at a battlefield" is one targeted effect.damage
 *   instruction; the target filter pins the unit to a battlefield location
 *   (location.type "battlefield"). When this card is played from facedown,
 *   811.1.d.2 further restricts the target to the battlefield it was hidden
 *   at; that restriction is enforced by the target system at Finalize
 *   (RIFT-90), not by this data.
 * - "Play a Gold gear token exhausted." is NOT expressible with merged
 *   primitives, so this card stays judge-required:
 *   - effect.token (RIFT-63) explicitly documents that token definitions
 *     carrying other abilities — including Gold (187.5: "[Reaction][>] Kill
 *     this, [E]: [Add] [A]") — and entry-exhaustion overrides
 *     ("Play ... exhausted", 143.4 / 185.2.d) remain blocked;
 *   - playing a NEW token needs the frozen create-token action's
 *     to "chain" path plus the effect.play handoff (440.2.c / 185.2.a /
 *     350.2 / 354, contract changelog RIFT-62), which the merged kernel
 *     create-token action does not yet accept.
 *   The damage half is fully described and executed in isolation by the
 *   golden test.
 */
const wagesOfPain = {
  canonicalCardId: "card.hash-431738fdce44471075e7d0f77a009dde71d56c7be7e2c9ef022d6b124a857a3c",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    '"Play a Gold gear token exhausted." has no merged primitive: effect.token blocks token ' +
    "definitions with abilities (Gold gear, CR 187.5) and blocks entry overrides such as " +
    '"exhausted" (143.4 / 185.2.d); playing a new token also needs the create-token ' +
    '"chain" destination plus the effect.play handoff (440.2.c / 185.2.a, contract ' +
    "changelog RIFT-62), which the merged kernel action does not yet accept.",
  abilities: [
    { kind: "keyword", keyword: "hidden" },
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      body: [
        {
          id: "deal-3",
          op: "effect.damage",
          args: {
            amount: { kind: "constant", value: 3 },
            target: { kind: "constant", value: "damaged-unit" }
          },
          targets: [
            {
              id: "damaged-unit",
              filter: { types: "unit", location: { type: "battlefield" } },
              selection: "one"
            }
          ]
        },
        {
          id: "play-gold-token",
          op: "effect.play-gold-token-exhausted",
          args: {}
        }
      ]
    }
  ],
  sourceText:
    "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
    "[Action] (Play on your turn or in showdowns.)\n" +
    "Deal 3 to a unit at a battlefield. Play a Gold gear token exhausted."
} satisfies CardProgram;

export default wagesOfPain;

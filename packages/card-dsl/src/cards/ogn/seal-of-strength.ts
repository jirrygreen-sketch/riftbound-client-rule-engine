import type { CardProgram } from "../../ir/index.js";

/**
 * Seal of Strength (ogn-163-298) — Gear, 0 Energy + 1 Body Power.
 *
 * "[Exhaust]: [Reaction] — [Add] :rb_rune_body:. (Abilities that add resources
 *  can't be reacted to.)"
 *
 * CR v1.5 anchors:
 * - 430 / 430.1: Adding puts resources into the Rune Pool; this adds one Body
 *   Power. 430.2 / 430.2.a: triggered and activated Add abilities finalize
 *   immediately, before priority or focus can pass; 430.3: a Reaction Add can
 *   be activated at any time, including during cost payment.
 * - 415.4 / 415.5: "[Exhaust]" on an ability is the cost "Exhaust this"; the
 *   action must be completable (source ready and on the Board). Finalize owns
 *   cost legality (contract 3.5 / cost-plan task RIFT-89/90).
 * - 813.1: [Reaction] is a permissive keyword granting closed-state timing.
 *
 * Status rationale: every part is declared with merged data shapes — the
 * activated ability with its exhaust cost and reaction timing, and the
 * effect.resources body. The exhaust cost and reaction timing are checked by
 * chain Finalize, not by a card-local instruction; golden tests exercise the
 * merged effect.resources primitive with the program's own arguments.
 */
const sealOfStrength = {
  canonicalCardId: "card.hash-6a0595ffe067b24200ab041d201195a0e2583fabab24b3f54c8d25446b69c7f3",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    {
      kind: "activated",
      cost: {
        kind: "activated",
        payments: [{ kind: "exhaust" }]
      },
      timing: "reaction",
      body: [
        {
          id: "seal-of-strength.add-body",
          op: "effect.resources",
          args: {
            power: { kind: "constant", value: ["Body"] },
            linkKey: { kind: "constant", value: "added" }
          }
        }
      ]
    }
  ],
  sourceText:
    ":rb_exhaust:: [Reaction] — [Add] :rb_rune_body:. (Abilities that add resources can't be reacted to.)"
} satisfies CardProgram;

export default sealOfStrength;

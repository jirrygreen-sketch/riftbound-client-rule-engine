import type { CardProgram } from "../../ir/index.js";

/**
 * Detonate (sfd-005-221) — Spell, 1 Energy + 1 Fury power, Fury.
 *
 * Printed text:
 *   Kill a gear. Its controller draws 2.
 *
 * Catalog evidence (packages/card-data/data/deck-catalog.json, sfd-005-221):
 * cardType Spell, domains ["Fury"], energy 1, power 1, might null, tags [].
 * The printed ability line carries no [Action]/[Reaction]/[Hidden] keyword, so
 * the spell keeps its default timing (CR v1.5 159.2) and no speed keyword is
 * declared (contrast Void Seeker / Flash).
 *
 * Modeling notes (Core Rules v1.5):
 * - "Kill a gear" is a Choice of a specific Game Object in a Public zone, so
 *   the gear is Targeted (355.5, 355.7, 355.10.a); 355.9.a.1 reads "gear" as an
 *   object on the Board. 429.1.a.1.a / 429.6 format Kill as "Kill [one or more
 *   permanents]", and the merged `effect.kill` primitive performs the Active
 *   Kill through the closed `kill` GameAction (429.1, 429.2.a). Target legality
 *   is rechecked at Finalize and Resolve; an all-stale target set makes the
 *   instruction `ignored` (359.3.e.5 / contract 3.6 primitive rule 2).
 * - "Its controller draws 2" refers back to the gear killed by the previous
 *   instruction, so the two instructions are Linked Instructions in the sense
 *   of 359.3.e.14; the card declares `linkedTo` and reads the drawer from the
 *   target's `controller` characteristic. 359.3.e.13 lets the read look back at
 *   the gear's characteristics after it changed zones (the merged `effect.draw`
 *   resolves the ObjectRef through current-or-last-known information), and
 *   359.3.e.14.a makes a mistargeted kill also ignore the draw.
 * - The printed cost (1 Energy + 1 Fury power) is declared from the catalog so
 *   the card is self-describing; the Finalize cost plan is its consumer.
 *
 * Status: executable. Both printed instructions are merged primitives
 * (effect.kill, effect.draw), no keyword expansion is needed, and the golden
 * test executes the card's own body through the production chain adapter and
 * the reference kernel, including the replaced-kill and lost-target boundaries.
 */
export default {
  canonicalCardId: "card.hash-63b9de4f44f858cfa58a8855dfcdf972520d0d14e9a614865b2987d56f1381ab",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    {
      kind: "play",
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 1 },
        power: { kind: "constant", value: 1 }
      },
      body: [
        {
          id: "detonate.kill-gear",
          op: "effect.kill",
          args: { target: { kind: "constant", value: "detonate.gear" } },
          targets: [
            {
              id: "detonate.gear",
              // 355.9.a.1: "gear" means an object on the Board unless stated
              // otherwise; no controller restriction is printed, so every
              // controller's gear is a legal target (355.9.b).
              filter: { type: "gear", zone: "board" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          // 359.3.e.14: "Its controller draws 2" references the object of the
          // linked kill; 359.3.e.13 allows the look-back read of its controller
          // after the gear left the Board. A lost target ignores this
          // instruction too (359.3.e.14.a), while a replaced kill does not
          // (359.3.e.14.b).
          id: "detonate.controller-draws",
          op: "effect.draw",
          linkedTo: "detonate.kill-gear",
          args: {
            amount: { kind: "constant", value: 2 },
            player: {
              kind: "object-property",
              object: { target: "detonate.gear" },
              property: "controller"
            }
          }
        }
      ]
    }
  ],
  sourceText: "Kill a gear. Its controller draws 2."
} satisfies CardProgram;

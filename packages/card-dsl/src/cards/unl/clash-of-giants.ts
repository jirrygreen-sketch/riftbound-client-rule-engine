import type { CardProgram } from "../../ir/index.js";

/**
 * Clash of Giants (unl-110-219) — Spell, 6 energy + 2 power, Body.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, unl-110-219, verbatim):
 *   "Choose two units. They deal damage equal to their Mights to each other."
 *
 * Rules evidence (Core Rules v1.5):
 * - "Choose two units" names two specific Board objects, so both are targets
 *   (355.5 / 355.7 / 355.9.a.1); they are locked while the spell is finalized
 *   (355.8). "Two units" are two Game Objects, so the second choice excludes
 *   the first with the merged `exclude` anchor (the same anchor
 *   ogn/dragons-rage-lee-sin uses for "another enemy unit"); that keeps the
 *   printed count of two distinct units instead of letting one unit be picked
 *   twice.
 * - "They deal damage equal to their Mights to each other" is two Deal actions
 *   (418.1.d) whose sources are the chosen units, not this spell (418.6.b.3,
 *   whose own example is Challenge — the same wording); 418.6.b.4 makes the
 *   source unit's controller responsible for its Deal. Each direction is one
 *   effect.damage instruction whose amount reads its own unit's current Might
 *   through an object-property expression (contract 3.6: expressions are
 *   evaluated when used, so an intervening Might change is respected). Null or
 *   non-positive Might yields no Valid Damage (418.1.e / 418.1.e.1) rather than
 *   a substitution.
 * - Neither instruction is `linkedTo` the other: the damage amounts are read
 *   from the units, and no instruction references the other's result
 *   (359.3.e.14 defines linked instructions by anaphoric reference). Both units
 *   are damaged before any Cleanup can kill a lethally damaged unit (320/321,
 *   323.4), so the printed order does not matter.
 * - The printed cost is 6 Energy + 2 Body power from the catalog (206 / 204.1);
 *   the spell prints no [Action]/[Reaction] keyword, so no speed keyword is
 *   declared (spells default to Action timing, 159.2.a).
 *
 * Status: executable. Both Deal instructions use the merged effect.damage
 * primitive with the merged target and expression vocabulary; the golden test
 * executes the program's own body through the interpreter and reference kernel
 * and covers the mutual damage, the Might-at-resolution boundary, the
 * zero-Might no-damage boundary and a mistargeted unit.
 */
export default {
  canonicalCardId:
    "card.hash-a16acd4fee0dfec2b4646c11865b24e416113a307ddab35294168618aa9d4856",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    {
      kind: "play",
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 6 },
        power: { kind: "constant", value: 2 }
      },
      body: [
        {
          id: "clash-of-giants.first-unit-deals",
          op: "effect.damage",
          args: {
            amount: {
              kind: "object-property",
              object: { target: "clash-of-giants.first-unit" },
              property: "might"
            },
            source: {
              kind: "object-property",
              object: { target: "clash-of-giants.first-unit" },
              property: "ref"
            },
            target: { kind: "constant", value: "clash-of-giants.second-unit" }
          },
          targets: [
            {
              id: "clash-of-giants.first-unit",
              // "Choose two units": both choices are made while the spell is
              // finalized (355.5 / 355.8), so both specs live on the first
              // instruction and the second instruction re-uses them
              // (the gentlemens-duel convention).
              filter: { type: "unit", zone: "board" },
              min: 1,
              max: 1,
              selection: "one"
            },
            {
              id: "clash-of-giants.second-unit",
              // "two units": the second unit is any unit on the Board minus
              // the unit already chosen first (355.9.a.1).
              filter: {
                type: "unit",
                zone: "board",
                exclude: { target: "clash-of-giants.first-unit" }
              },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          id: "clash-of-giants.second-unit-deals",
          op: "effect.damage",
          args: {
            amount: {
              kind: "object-property",
              object: { target: "clash-of-giants.second-unit" },
              property: "might"
            },
            source: {
              kind: "object-property",
              object: { target: "clash-of-giants.second-unit" },
              property: "ref"
            },
            target: { kind: "constant", value: "clash-of-giants.first-unit" }
          },
          // The second direction re-uses the targets locked on the first
          // instruction; it declares no new selection (355.5: the choices are
          // made once, while finalizing).
        }
      ]
    }
  ],
  sourceText: "Choose two units. They deal damage equal to their Mights to each other."
} satisfies CardProgram;

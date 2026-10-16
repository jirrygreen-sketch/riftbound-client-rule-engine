import type { CardProgram } from "../../ir/index.js";

/**
 * Challenge (ogn-128-298) — Spell, 2 energy + 1 Body power.
 *
 * Printed text:
 *   [Action] (Play on your turn or in showdowns.)
 *   Choose a friendly unit and an enemy unit. They deal damage equal to their
 *   Mights to each other.
 *
 * Modeling notes (Core Rules v1.5):
 * - `keyword: "action"` declares the printed [Action] permission (806 / 159.2.a).
 *   Admission is chain-owned; the card only names the keyword (contract 3.7).
 * - "Choose a friendly unit and an enemy unit": both units are on the Board (a
 *   public zone) and are chosen specifically, so both are Targets (355.7 /
 *   355.9.a.1 / 355.5); they are declared as two TargetSpecs and are locked at
 *   Finalize (355.3/355.5). A non-target pick would wrongly skip became-target
 *   handling, and a single two-unit spec cannot name one friendly and one enemy.
 * - Damage is one Deal action per direction with the chosen unit as the source:
 *   418.6.b.3 names this exact card ("The damage that Challenge causes to be
 *   dealt is dealt by the chosen units, not by Challenge"), and 418.6.b.4 makes
 *   the source unit's controller responsible. `effect.damage` takes that source
 *   as an Expr evaluating to an ObjectRef; the chosen units come from
 *   `{ target: ... }` selectors, which the interpreter binds to the finalized
 *   targets. `property: "ref"` reads the declared ObjectSnapshot.ref field
 *   (contract 3.6) — the same shape sfd-107-221 Strike Down needs for its
 *   picked unit and cannot express because its unit is a pick, not a target.
 * - "equal to their Mights" is read at resolution (contract 3.6: value
 *   expressions are evaluated when used), so an intervening Might change is
 *   respected. Null Might is not coerced: 418.1.e/.e.1 only positive damage is
 *   dealt, and the engine's amount normalization yields no damage for null.
 * - The two Deal actions are two instructions, not one simultaneous action
 *   (303.2: game actions are never simultaneous; 370.1.a.2's counter-example is
 *   exactly "two kill game actions being performed in the instructions"). Both
 *   units are damaged before any Cleanup can kill a lethally damaged unit (320 /
 *   321), so the order of the two instructions does not change the outcome.
 * - Neither instruction is `linkedTo` the other: they are independent
 *   sentences of one instruction ("They deal ... to each other"), each reading
 *   the other's target through its own selector. 359.3.e.7/.12 still applies:
 *   if a chosen unit is unavailable the instruction reading or harming it is
 *   ignored rather than replaced by a stale value.
 * - Non-combat damage: the printed effect is a Deal action of the resolution,
 *   so `combat` stays at its false default (418.6.c is combat-step damage).
 */
const challenge = {
  canonicalCardId: "card.hash-27cf1792f7bb4da955117bb4a15cb33f4e4705984cacfac9055a2884b061e4e1",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      body: [
        {
          id: "friendly-deals",
          op: "effect.damage",
          args: {
            amount: {
              kind: "object-property",
              object: { target: "friendly-unit" },
              property: "might"
            },
            source: {
              kind: "object-property",
              object: { target: "friendly-unit" },
              property: "ref"
            },
            target: { kind: "constant", value: "enemy-unit" }
          },
          targets: [
            {
              id: "enemy-unit",
              filter: { type: "unit", controller: "opponent" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          id: "enemy-deals",
          op: "effect.damage",
          args: {
            amount: {
              kind: "object-property",
              object: { target: "enemy-unit" },
              property: "might"
            },
            source: {
              kind: "object-property",
              object: { target: "enemy-unit" },
              property: "ref"
            },
            target: { kind: "constant", value: "friendly-unit" }
          },
          targets: [
            {
              id: "friendly-unit",
              filter: { type: "unit", controller: "self" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ],
  sourceText:
    "[Action] (Play on your turn or in showdowns.)\n" +
    "Choose a friendly unit and an enemy unit. They deal damage equal to their Mights to each other."
} satisfies CardProgram;

export default challenge;

import type { CardProgram } from "../../ir/index.js";

/**
 * Showstopper, Sett (ogn-270-298) — Spell, 1 energy + 1 Body power
 * (Body/Order, Sett Signature).
 *
 * Printed text:
 *   Buff a friendly unit in your base, then move it to a battlefield.
 *   (If it doesn't have a buff, it gets a +1 :rb_might: buff.)
 *
 * Modeling notes (Core Rules v1.5):
 * - "Buff a friendly unit in your base" is the merged effect.buff primitive in
 *   "buff" mode: 702.2.a places one Buff counter on the chosen unit, while
 *   702.3 / 427.1.c keep a unit that already has a Buff a legal choice that
 *   simply is not buffed again. The reminder text restates exactly that
 *   behaviour, so it is not a separate instruction. "a friendly unit in your
 *   base" is a Choice (355.5 / 355.7).
 * - "then move it to a battlefield" moves that same unit as an effect Move,
 *   not the Standard Move ability (144, 451.1), so it neither exhausts nor
 *   charges the unit. "It" is the unit already chosen for the Buff, so the Move
 *   consumes the same Finalize-locked TargetSpec rather than making a second
 *   choice, and it is linked to the Buff instruction so a lost unit ignores the
 *   follow-up (contract 3.4 / CR 359.3.e).
 * - "to a battlefield" leaves the Destination to the controller among the
 *   runtime-legal Locations (355.4 / 355.4.a: a valid Location is one other
 *   than the unit's current Location where it is allowed to be present). The
 *   merged LocationTargetSpec + target-location binding supplies that
 *   Finalize-time choice without fixing a battlefield.
 *
 * Status: executable (re-reviewed 2026-10-17). The Buff target and the
 * battlefield Destination are both selected through the merged target/location
 * resolver, and the Move reads the same locked unit and selected Location.
 */
const showstopper = {
  canonicalCardId: "card.hash-b22bcf86e002f1a9a45cb4011a53cb3377c815e03ab16283a99130fec4987f95",
  rulesetVersion: "core-1.5",
  status: "executable",
  sourceText:
    "Buff a friendly unit in your base, then move it to a battlefield. " +
    "(If it doesn't have a buff, it gets a +1 :rb_might: buff.)",
  abilities: [
    {
      kind: "play",
      body: [
        {
          id: "buff-friendly-unit-in-base",
          op: "effect.buff",
          args: {
            mode: { kind: "constant", value: "buff" },
            target: { kind: "constant", value: "friendly-unit-in-base" }
          },
          targets: [
            {
              id: "friendly-unit-in-base",
              // "a friendly unit in your base": the object filter supplies the
              // friendly unit, while target.location resolves the controller's
              // own Base at Finalize (355.7 / 355.9.b).
              filter: { type: "unit", controller: "self" },
              location: { type: "base", player: "controller" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          id: "move-buffed-unit",
          op: "effect.move",
          linkedTo: "buff-friendly-unit-in-base",
          locations: [
            {
              id: "showstopper.destination",
              type: "battlefield",
              min: 1,
              max: 1,
              selection: "one"
            }
          ],
          args: {
            // "then move it": the same Finalize-locked unit the Buff chose,
            // not a second selection.
            objects: { kind: "constant", value: { target: "friendly-unit-in-base" } },
            // "to a battlefield" — the Destination is the runtime Location
            // selected by the instruction's LocationTargetSpec (355.4.a).
            to: {
              kind: "location",
              value: { kind: "target-location", target: "showstopper.destination" }
            }
          }
        }
      ]
    }
  ]
} satisfies CardProgram;

export default showstopper;


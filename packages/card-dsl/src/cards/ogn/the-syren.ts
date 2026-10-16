import type { CardProgram } from "../../ir/index.js";

/**
 * The Syren (ogn-184-298) — Gear, 2 Energy, Chaos.
 *
 * ":rb_energy_1:, :rb_exhaust:: Move a friendly unit at a battlefield to your
 *  base."
 *
 * CR v1.5 anchors:
 * - The ability has no [Action]/[Reaction] permission, so it is activated at
 *   action speed with the printed costs: 1 Energy plus "exhaust this"
 *   (415.4/415.5). Cost-plan support is merged; Finalize checks it.
 * - 421 / 448: "Move a friendly unit at a battlefield to your base" is a Move
 *   between two Board locations. effect.move expresses it with a TargetSpec
 *   (one friendly unit at a battlefield) and the controller-base destination;
 *   the destination placeholder "controller-base" is resolved by the primitive
 *   against each object's current controller.
 * - 355.10.g / 355.9.a.1: "a friendly unit" is a defined Board object chosen
 *   as a target; the merged TargetSpec carries the selection.
 *
 * Status rationale: the activated structure, exhaust/energy cost and the move
 * body are all expressible with merged code; golden tests execute the exact
 * effect.move instruction through the reference kernel.
 */
const theSyren = {
  canonicalCardId: "card.hash-7fd32ee4cb0ba1308e359bf310991f144892e53c69a893cec7c4205fbfc24206",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    {
      kind: "activated",
      cost: {
        kind: "activated",
        energy: { kind: "constant", value: 1 },
        payments: [{ kind: "exhaust" }]
      },
      timing: "action",
      body: [
        {
          id: "the-syren.move-to-base",
          op: "effect.move",
          args: {
            objects: { kind: "constant", value: { target: "the-syren.friendly-unit" } },
            to: { kind: "constant", value: "controller-base" },
            amount: { kind: "constant", value: 1 },
            linkKey: { kind: "constant", value: "moved" }
          },
          targets: [
            {
              id: "the-syren.friendly-unit",
              filter: { type: "unit", controller: "self", zone: "board", location: "battlefield" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ],
  sourceText: ":rb_energy_1:, :rb_exhaust:: Move a friendly unit at a battlefield to your base."
} satisfies CardProgram;

export default theSyren;

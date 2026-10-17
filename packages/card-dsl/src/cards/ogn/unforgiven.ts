import type { CardProgram } from "../../ir/index.js";

/**
 * Unforgiven (ogn-259-298) — Legend, Calm/Chaos, tag Yasuo.
 *
 * Printed text:
 *   :rb_energy_2:, :rb_exhaust:: Move a friendly unit to or from your base.
 *
 * Structure (contract 3.1/3.2):
 * - activated ability, action timing, cost = 2 energy + exhaust this legend
 *   (the :rb_exhaust: symbol is the exhaust payment kind, CR 415.5);
 * - "a friendly unit" is a target (CR 355.5, 355.10: a unit you control on the
 *   Board, 355.9.a.1), declared as a TargetSpec on the move instruction;
 * - "to or from your base" is ONE Move instruction whose destination is chosen
 *   at Finalize from the legal locations (CR 355.4: choose a valid Location as
 *   the Move Destination; 451.1: the Move source provides destination
 *   restrictions; 449.1/449.2 define Origin/Destination). The printed text does
 *   not add a mode: the direction follows from where the unit currently is.
 *
 * Status: executable (re-reviewed 2026-10-17). The merged location selectors
 * and effect.move destination chooser now express both directions:
 * capture the selected unit's location before moving, send a unit at its
 * controller's Base to a player-chosen Battlefield, and send a unit elsewhere
 * to its controller's Base. The target remains the same locked TargetSpec in
 * both branches, so no second target choice is introduced and a stale target
 * is ignored by the normal resolver rules.
 *
 * The local printing says "your base". The target is restricted to a friendly
 * unit controlled by the ability controller, so that Base is the controller's
 * Base in this program; no teammate-controlled unit is admitted by the target
 * filter. The source text and canonical identity remain unchanged.
 */
const program = {
  canonicalCardId:
    "card.hash-6c69039e3668542be770179f1820017af14307a2e3e79a1c71a35edc3e408061",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    {
      kind: "activated",
      timing: "action",
      cost: {
        energy: { kind: "constant", value: 2 },
        payments: [{ kind: "exhaust" }]
      },
      body: [
        {
          id: "unforgiven.capture-origin",
          op: "condition.value",
          args: {
            value: {
              kind: "object-property",
              object: { target: "unit" },
              property: "location"
            },
            key: { kind: "constant", value: "origin" }
          }
        },
        {
          id: "unforgiven.move-from-base",
          op: "effect.move",
          condition: {
            kind: "compare",
            left: {
              kind: "linked-value",
              instructionId: "unforgiven.capture-origin",
              key: "origin"
            },
            operator: "eq",
            right: {
              kind: "location",
              value: { kind: "target-controller-base", target: "unit" }
            }
          },
          args: {
            objects: { kind: "constant", value: { target: "unit" } },
            to: {
              kind: "location",
              value: {
                kind: "choose",
                id: "unforgiven.battlefield",
                filter: { type: "battlefield" }
              }
            }
          },
          targets: [
            {
              id: "unit",
              filter: { type: "unit", controller: "controller", zone: "board" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          id: "unforgiven.move-to-base",
          op: "effect.move",
          condition: {
            kind: "compare",
            left: {
              kind: "linked-value",
              instructionId: "unforgiven.capture-origin",
              key: "origin"
            },
            operator: "ne",
            right: {
              kind: "location",
              value: { kind: "target-controller-base", target: "unit" }
            }
          },
          args: {
            objects: { kind: "constant", value: { target: "unit" } },
            to: {
              kind: "location",
              value: { kind: "target-controller-base", target: "unit" }
            }
          },
          targets: [
            {
              id: "unit",
              filter: { type: "unit", controller: "controller", zone: "board" },
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
    ":rb_energy_2:, :rb_exhaust:: Move a friendly unit to or from your base."
} satisfies CardProgram;

export default program;

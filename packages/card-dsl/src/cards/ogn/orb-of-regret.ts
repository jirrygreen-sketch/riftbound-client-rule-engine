import type { CardProgram } from "../../ir/index.js";

/**
 * Orb of Regret (ogn-090-298) — Gear, 1 energy, Mind.
 *
 * Printed text:
 *   :rb_exhaust:: Give a unit -1 :rb_might: this turn, to a minimum of 1
 *   :rb_might:.
 *
 * Rules evidence (Core Rules v1.5):
 * - 415.4 / 415.5: the leading :rb_exhaust: symbol is the cost "Exhaust this".
 * - 478.x: "-1 [M] this turn" is a temporary Might modification evaluated in
 *   the layers system with an end-of-turn duration; "to a minimum of 1 [M]"
 *   is the printed clamp on that modification.
 *
 * Status: executable — the exhaust cost, continuous.might instruction, end-of-turn
 * duration, and per-effect minimum clamp are all registered and covered by a real
 * interpreter plus layer-engine execution test.
 */
const orbOfRegret = {
  canonicalCardId: "card.hash-1ce54e160f6984f8d86e60ea1ad700d535426e0e5294239b98f64ec422574d96",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    {
      kind: "activated",
      cost: { kind: "activated", payments: [{ kind: "exhaust" }] },
      timing: "action",
      body: [
        {
          // "Give a unit -1 [M] this turn, to a minimum of 1 [M]" — described
          // via the layers contract shape; no merged primitive consumes it yet
          // (see judgeReason).
          id: "give-minus-1-might",
          op: "continuous.might",
          args: {
            target: { kind: "constant", value: "affected-unit" },
            amount: { kind: "constant", value: -1 },
            duration: { kind: "constant", value: "this-turn" },
            minimum: { kind: "constant", value: 1 }
          },
          targets: [
            {
              id: "affected-unit",
              filter: { type: "unit", zone: "board" },
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
    ":rb_exhaust:: Give a unit -1 :rb_might: this turn, to a minimum of 1 :rb_might:."
} satisfies CardProgram;

export default orbOfRegret;

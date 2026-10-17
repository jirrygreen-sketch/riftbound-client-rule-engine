import type { CardProgram } from "../../ir/index.js";

/**
 * Primal Strength (ogn-154-298) — Spell, 4 energy + 1 Body power.
 *
 * Printed text:
 *   [Action] (Play on your turn or in showdowns.)
 *   Give a unit +7 :rb_might: this turn.
 *
 * Modeling notes (Core Rules v1.5):
 * - [Action] (806) is declared as a keyword ability; the keyword registry
 *   owns its expansion (contract 3.7).
 * - "Give a unit +7 :rb_might: this turn" chooses one unit on the board
 *   (355.9.a.1: "unit" means an object on the board unless stated otherwise),
 *   so the instruction carries a one-unit TargetSpec and reads that choice
 *   through the contract 3.6 target selector.
 * - The modification is a temporary Might change executed by the merged
 *   continuous.might primitive (RIFT-258): it registers one arithmetic-layer
 *   effect per resolved object through ResolveContext.addContinuous with the
 *   end-of-turn duration (143.2.a / 478; "this turn" expires in the cleanup
 *   step per 317.1.a / 468.7.c, layers/ops resolveContinuousDuration).
 *   effect.buff (702/703) is not used: a Buff counter is a counter, not a
 *   Might modification.
 *
 * Status: executable — the printed ability executes on merged paths and the
 * golden test drives the card's own body through the interpreter + layer
 * engine, asserting the arithmetic-layer registration, the +7 result, the
 * end-of-turn expiry and the mistargeted edge.
 */
const primalStrength = {
  canonicalCardId: "card.hash-973d0d5d514cd0b81080d51a93fd58adb4be5b542b6ac111f49c4202d30e1abf",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      body: [
        {
          id: "primal-strength.give-plus-7",
          // +7 Might for the rest of the turn (143.2.a / 478), applied in the
          // layers arithmetic layer and expiring at cleanup (317.1.a).
          op: "continuous.might",
          args: {
            amount: { kind: "constant", value: 7 },
            duration: { kind: "constant", value: "this-turn" },
            objects: {
              kind: "constant",
              value: { kind: "target", id: "primal-strength.unit" }
            }
          },
          targets: [
            {
              id: "primal-strength.unit",
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
    "[Action] (Play on your turn or in showdowns.)\n" +
    "Give a unit +7 :rb_might: this turn."
} satisfies CardProgram;

export default primalStrength;


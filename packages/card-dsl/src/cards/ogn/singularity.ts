import type { CardProgram } from "../../ir/index.js";

/**
 * Singularity — ogn-105-298 (Spell, Mind, Rumble SFD champion precon).
 *
 * Printed text:
 *   Deal 6 to each of up to two units.
 *
 * Modeling notes (Core Rules v1.5):
 * - One TargetSpec (damaged-units) selecting up to two units
 *   (selection "up-to", min 0, max 2). This is ordinary targeting, not
 *   damage splitting (355.14): the amount is a fixed 6 dealt to each target,
 *   so effect.damage submits one damage GameAction per still legal target
 *   (418.1.c) without divide.
 * - There is no speed keyword: spells default to Action timing (159.2.a),
 *   so no keyword ability is declared.
 */
const singularity = {
  canonicalCardId: "card.hash-10b7d5be25093a4d318efd8639b6e34583bad10bf38adbf93b4c3733ea54221b",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    {
      kind: "play",
      body: [
        {
          id: "deal-6-each",
          op: "effect.damage",
          args: {
            amount: { kind: "constant", value: 6 },
            target: { kind: "constant", value: "damaged-units" }
          },
          targets: [
            {
              id: "damaged-units",
              filter: { types: "unit" },
              min: 0,
              max: 2,
              selection: "up-to"
            }
          ]
        }
      ]
    }
  ],
  sourceText: "Deal 6 to each of up to two units."
} satisfies CardProgram;

export default singularity;

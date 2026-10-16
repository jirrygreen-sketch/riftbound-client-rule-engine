import type { CardProgram } from "../../ir/index.js";

/**
 * Frigid Touch — sfd-066-221 (Spell, Mind, Rumble SFD champion precon).
 *
 * Printed text:
 *   [Reaction] (Play any time, even before spells and abilities resolve.)
 *   [Repeat] [2] (You may pay the additional cost to repeat this spell's effect.)
 *   Give a unit -2 [M] this turn.
 *
 * Modeling notes (Core Rules v1.5):
 * - [Reaction] (813) is a keyword ability expanded by the keyword registry.
 * - [Repeat] [2] (820) is an Optional Additional Cost keyword. Per 820.1.d
 *   the paid cost causes the spell's instructions to be executed one
 *   additional time during resolution, with choices re-made (820.2 / 820.2.a).
 *   We therefore declare the 2-energy optional additional cost in the play
 *   ability's CostSpec (contract 3.1) and express the extra execution with a
 *   merged effect.repeat instruction (820.1.d.1) that re-reads the same
 *   TargetSpec, so a different unit may be chosen (820.2.a).
 * - "Give a unit -2 [M] this turn" is a temporary Might modification, which
 *   belongs to the layers system (continuous.might with an end-of-turn
 *   duration). effect.buff's own header states that temporary Might changes
 *   "belong to continuous.might, never to this primitive", and no layers
 *   consumer instruction is merged yet (RIFT-91), so there is no merged
 *   opcode for this instruction. effect.repeat does accept the closed "buff"
 *   GameAction, but using it would silently turn -2 Might into Buff counters
 *   — a near-implementation the red line forbids — so the repeated execution
 *   is judge-required for the same reason.
 */
const frigidTouch = {
  canonicalCardId: "card.hash-153eb4df721b70662a63652ba1602985ceed08d81a0b23fc0d6b10349ee15ca9",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    '"Give a unit -2 [M] this turn" is a temporary continuous Might modification; the ' +
    "layers consumer (continuous.might, RIFT-91) is not merged, and the only merged Might " +
    "primitive is effect.buff, which covers Buff counters (702 / 703) and not temporary " +
    "Might changes. Repeat payment counting (820.1.c.1) also has no merged cost hook " +
    "(RIFT-86 / RIFT-89), so the repeat body cannot read the paid count.",
  abilities: [
    { kind: "keyword", keyword: "reaction" },
    {
      kind: "play",
      cost: {
        kind: "additional",
        payments: [
          {
            kind: "energy",
            amount: { kind: "constant", value: 2 },
            choice: {
              id: "repeat-payment",
              options: ["pay", "decline"],
              selection: "one"
            }
          }
        ]
      },
      body: [
        {
          id: "give-minus-2-might",
          op: "continuous.might",
          args: {
            amount: { kind: "constant", value: -2 },
            duration: { kind: "constant", value: "this-turn" },
            target: { kind: "constant", value: "affected-unit" }
          },
          targets: [
            {
              id: "affected-unit",
              filter: { types: "unit" },
              selection: "one"
            }
          ]
        },
        {
          id: "repeat-effect",
          op: "effect.repeat",
          args: {
            count: { kind: "constant", value: 1 },
            actions: {
              kind: "constant",
              value: [
                {
                  type: "buff",
                  values: { amount: { kind: "constant", value: -2 } },
                  targets: { object: "affected-unit" }
                }
              ]
            }
          },
          linkedTo: "give-minus-2-might"
        }
      ]
    }
  ],
  sourceText:
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "[Repeat] :rb_energy_2: (You may pay the additional cost to repeat this spell's effect.)\n" +
    "Give a unit -2 :rb_might: this turn."
} satisfies CardProgram;

export default frigidTouch;

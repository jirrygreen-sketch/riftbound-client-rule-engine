import type { CardProgram } from "../../ir/index.js";

/**
 * Rune Prison (ogn-050-298) — Spell, 2 energy + 1 Calm power (Calm).
 *
 * Printed text:
 *   [Action] (Play on your turn or in showdowns.)
 *   Stun a unit. (It doesn't deal combat damage this turn.)
 *
 * Modeling notes (Core Rules v1.5):
 * - [Action] (806) is a keyword ability expanded by the keyword registry
 *   (contract 3.7); the card only names the speed permission.
 * - "Stun a unit" is the merged effect.stun primitive: Stunning selects one or
 *   more Units on the Board and renders them Stunned (424.1), a Stunned Unit
 *   cannot be Stunned again (424.1.a.1 — the primitive keeps such objects out
 *   of its amount budget and reports alreadyStunned), and "a unit" is a target
 *   (355.7 / 355.9.a.1: "unit" means an object on the Board). Target legality
 *   at Finalize/Resolve is the target system's obligation (359.3.e; RIFT-90).
 * - The reminder text "(It doesn't deal combat damage this turn.)" is the
 *   consequence of the Stunned state itself (424.1.b: a Stunned Unit does not
 *   contribute its Might to damage in the combat damage step; 424.1.c keeps its
 *   full-Might lethal threshold). It is not a separate instruction, so no
 *   additional instruction is authored.
 *
 * Status: executable — every part of the printed ability has a merged path:
 * the [Action] keyword declaration (806), the single targeted effect.stun
 * instruction, and the state-driven combat-damage consequence owned by the
 * Stunned state. No missing primitive blocks this card's data.
 *
 * Obligations of the surrounding flow stay outside this card's data and are
 * recorded as TODOs in the golden test: Stunned expiry at step 3d of the end
 * of turn cleanup (424.1.a.2) is a turn/cleanup obligation, and the
 * combat-damage consequence (424.1.b) belongs to combat.
 */
const runePrison = {
  canonicalCardId: "card.hash-6347b24ab04866148459050aad3a3ee903e16b2873c869ef49ba20384d26ba18",
  rulesetVersion: "core-1.5",
  status: "executable",
  sourceText:
    "[Action] (Play on your turn or in showdowns.)\n" +
    "Stun a unit. (It doesn't deal combat damage this turn.)",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      body: [
        {
          id: "stun-a-unit",
          op: "effect.stun",
          args: { target: { kind: "constant", value: "stunned-unit" } },
          targets: [
            {
              id: "stunned-unit",
              // "a unit" — any one unit on the Board (355.9.a.1).
              filter: { type: "unit" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ]
} satisfies CardProgram;

export default runePrison;

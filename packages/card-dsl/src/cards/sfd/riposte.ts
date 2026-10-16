import type { CardProgram } from "../../ir/index.js";

/**
 * sfd-206-221 Riposte (Spell, Body/Order, Signature — Fiora)
 * "[Reaction] (Play any time, even before spells and abilities resolve.)
 *  Choose a friendly unit and a spell. Counter that spell and give that unit
 *  +[M] equal to that spell's Energy cost this turn."
 *
 * Catalog evidence (deck-catalog.json, dataVersion 2026-10-12-official-gallery):
 * energy 2, power 2, tags ["Fiora", "Signature"].
 *
 * Structure (contract 3.1 / 3.2):
 * - `keyword: "reaction"` keeps the printed [Reaction] keyword (CR v1.5 813:
 *   the card can be played during Closed States on any player's turn); the
 *   timing permission itself is owned by the keyword registry + chain module.
 * - "Choose a friendly unit and a spell" — both are targets (355.7): the spell
 *   is targeted on the chain, and pending chain items cannot be targets
 *   (contract 3.4). Target legality is rechecked at Finalize and Resolve
 *   (359.3.e); an all-stale target set makes the instruction `ignored`.
 * - `effect.counter` counters the spell (426.1-426.3: countered card does
 *   nothing, leaves the chain, costs are not refunded) and links the
 *   countered object references under "counteredObjects".
 * - "give that unit +[M] ... this turn" is an arithmetic continuous effect
 *   with an end-of-turn duration whose value is the countered spell's Energy
 *   cost (Show-Off-style locking per contract 3.4: the value is locked when
 *   read during resolution, so the spell leaving the chain does not unset it).
 *
 * Status is judge-required: no merged primitive currently creates a
 * value-carrying temporary Might modification (`continuous.might` with
 * `continuous.duration` from the M1 primitive list), so the second clause
 * cannot be declared with only merged ops. The body is the nearest faithful
 * structure, and judgeReason records the exact missing primitive instead of
 * approximating the Might grant with Buff counters (CR 702: Buffs are
 * counters, not a printed Might change).
 */
export default {
  canonicalCardId: "card.hash-6e1bdc294002f23d867897b239a644801a07effca16fc07c31ab55c7f41ff26d",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "Missing merged primitive for the temporary Might modification: 'give that unit +[M] equal to " +
    "that spell's Energy cost this turn' needs a continuous.might arithmetic effect with an " +
    "end-of-turn duration (continuous.duration) via ctx.addContinuous; effects/instructions " +
    "currently exposes no such op (effect.buff only adds CR 702 Buff counters, which are not a " +
    "Might value change, and has no duration). The counter clause itself is fully covered by " +
    "effect.counter. Tracked under the M1 continuous.might / continuous.duration primitive work " +
    "(RIFT-87); until it lands, the 'grant-might' instruction references the planned " +
    "'effect.modify-might' op and does not execute.",
  abilities: [
    { kind: "keyword", keyword: "reaction" },
    {
      kind: "play",
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 2 },
        power: { kind: "constant", value: 2 }
      },
      body: [
        {
          id: "counter-spell",
          op: "effect.counter",
          args: { target: { kind: "constant", value: "target-spell" } },
          targets: [
            {
              id: "target-spell",
              filter: { type: "spell", zone: "chain" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          id: "grant-might",
          op: "effect.modify-might",
          linkedTo: "counter-spell",
          args: {
            target: { kind: "constant", value: "target-unit" },
            amount: {
              kind: "linked-value",
              instructionId: "counter-spell",
              key: "counteredEnergy"
            },
            duration: { kind: "constant", value: "end-of-turn" }
          },
          targets: [
            {
              id: "target-unit",
              filter: { type: "unit", controller: "you" },
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
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "Choose a friendly unit and a spell. Counter that spell and give that unit " +
    "+:rb_might: equal to that spell's Energy cost this turn."

} satisfies CardProgram;

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
 *   The merged `continuous.might` primitive (RIFT-258) registers that
 *   arithmetic-layer modification through ResolveContext.addContinuous with
 *   the end-of-turn duration (317.1.a / 468.7.c).
 * - The value read uses the merged `condition.value` shape (the same pattern
 *   as the merged ogn/faithful-manufactor program for a value the primitive
 *   schemas cannot take as a raw symbolic expression): the interpreter
 *   evaluates `object-property({ linked: "counter-spell" }, "energy")` at
 *   resolution time and binds it as a linked value, which `continuous.might`
 *   then consumes. CR 206: a card's cost is its printed cost, so the
 *   characteristic `energy` of the countered spell is the correct source and
 *   `energy: null` (no printed cost) is never coerced to 0.
 *
 * Status: executable. Both printed clauses run on merged paths: effect.counter
 * counters the chain spell and links the countered references, and the
 * Might clause registers a real end-of-turn arithmetic effect whose amount is
 * the locked printed Energy cost. The golden test drives the card's own body
 * through the production chain adapter and asserts the real counter, the
 * linked ignore chain when the spell is gone, the value lock, the
 * arithmetic-layer registration, the end-of-turn expiry and the
 * no-printed-cost boundary (a null Energy cost negates the grant instead of
 * turning it into 0).
 */
export default {
  canonicalCardId: "card.hash-6e1bdc294002f23d867897b239a644801a07effca16fc07c31ab55c7f41ff26d",
  rulesetVersion: "core-1.5",
  status: "executable",
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
          // "equal to that spell's Energy cost": CR 206 reads the printed cost
          // of the countered card. The interpreter evaluates the object
          // property against the reference linked by the counter (its last
          // known information once the spell has left the chain) and binds a
          // literal for the primitive below, which is the merged shape for a
          // value the primitive schemas cannot take as a raw symbolic
          // expression (see merged ogn/faithful-manufactor).
          id: "read-spell-energy",
          op: "condition.value",
          linkedTo: "counter-spell",
          args: {
            value: {
              kind: "object-property",
              object: { linked: "counter-spell" },
              property: "energy"
            },
            key: { kind: "constant", value: "energyCost" }
          }
        },
        {
          id: "grant-might",
          // "give that unit +[M] ... this turn": an arithmetic-layer Might
          // modification registered through ResolveContext.addContinuous
          // (RIFT-258) with the end-of-turn duration (317.1.a / 468.7.c).
          op: "continuous.might",
          linkedTo: "read-spell-energy",
          args: {
            objects: {
              kind: "constant",
              value: { kind: "target", id: "target-unit" }
            },
            amount: {
              kind: "linked-value",
              instructionId: "read-spell-energy",
              key: "energyCost"
            },
            duration: { kind: "constant", value: "this-turn" }
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

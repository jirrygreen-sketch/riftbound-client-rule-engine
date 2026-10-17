import type { CardProgram } from "../../ir/index.js";

/**
 * rad-048-167 High Note (Spell, 3 energy, Mind).
 *
 * Catalog evidence (packages/card-data/data/deck-catalog.json,
 * dataVersion 2026-10-12-official-gallery, printing rad-048-167):
 * energy 3, power null, might null, domains ["Mind"], tags [].
 * `power: null` means there is no printed power, so the play cost declares
 * energy only and never turns the missing power into 0.
 *
 * Printed text (verbatim, sourceText):
 *   "[Reaction] (Play any time, even before spells and abilities resolve.)
 *    Give a unit –:rb_might: this turn equal to the number of exhausted units
 *    you control."
 *
 * Rules reading (CR v1.5):
 * - [Reaction] (813) is declared as a keyword ability; its timing expansion
 *   (Reaction.ts + chain admission) belongs to the keyword registry and chain.
 * - "Give a unit –:rb_might: this turn" is a temporary Might modification with
 *   an end-of-turn duration: the merged layers arithmetic effect
 *   `continuous.might` (contract 3.4/3.6, RIFT-258), duration "this-turn" →
 *   end-of-turn expiry. It is not a Buff counter (702).
 * - The amount "equal to the number of exhausted units you control" is read
 *   when the effect resolves (contract 3.6: value expressions are evaluated at
 *   call time). The merged `continuous.might` schema takes the evaluated
 *   integer, so the count is computed by the merged `condition.value`
 *   arithmetic node and handed over as a linked value — the same read-then-use
 *   pattern the merged sfd/azir-sovereign and ogn/noxian-drummer programs use.
 * - "you control" is the ability controller (190.6.d), spelled with the
 *   contract selector "self" (chain/engine.ts normalizes it to the item's
 *   controller and layers/filter.ts matches it); `states: "exhausted"` is the
 *   exhausted condition of 415.2. Per contract 3.6, `count` queries all
 *   matching objects.
 * - "a unit" is a target (355.9.b/355.10: the instruction chooses one unit and
 *   no exception applies), so it is a TargetSpec, not a pick.
 *
 * Status: executable. Both instructions run on merged code: the count node
 * evaluates through the production query binding and `continuous.might`
 * registers the negative arithmetic-layer modification with its end-of-turn
 * duration. The golden test runs the card's own body through the chain
 * interpreter adapter with the production query wrapper and asserts the
 * computed -N, the layers result, the end-of-turn expiry, the zero-count no-op
 * and the lost-target branch.
 */
export default {
  canonicalCardId: "card.hash-94a6c9fbd1c07987c118b3c37993744abe6442237b9355dfa3faf6771ca2da54",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    { kind: "keyword", keyword: "reaction" },
    {
      kind: "play",
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 3 }
      },
      body: [
        {
          // "equal to the number of exhausted units you control": read the
          // count while the effect resolves (contract 3.6) and negate it, so
          // the Might instruction consumes an evaluated integer.
          id: "high-note.count-exhausted",
          op: "condition.value",
          args: {
            operands: {
              kind: "constant",
              value: [
                {
                  kind: "count",
                  subject: "exhausted-units-you-control",
                  filter: { type: "unit", controller: "self", states: "exhausted" }
                }
              ]
            },
            operator: { kind: "constant", value: "neg" },
            key: { kind: "constant", value: "value" }
          }
        },
        {
          // "Give a unit –Might this turn": one negative temporary Might
          // modification in the arithmetic layer, expiring at end of turn.
          id: "high-note.give-minus-might",
          op: "continuous.might",
          args: {
            objects: { kind: "constant", value: { kind: "target", id: "unit" } },
            amount: {
              kind: "linked-value",
              instructionId: "high-note.count-exhausted",
              key: "value"
            },
            duration: { kind: "constant", value: "this-turn" }
          },
          targets: [
            {
              id: "unit",
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
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "Give a unit –:rb_might: this turn equal to the number of exhausted units you control."
} satisfies CardProgram;

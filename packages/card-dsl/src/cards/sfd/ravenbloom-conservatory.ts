import type { CardProgram } from "../../ir/index.js";

/**
 * Ravenbloom Conservatory (sfd-215-221) — Battlefield, Rumble precon.
 *
 * "When you defend here, reveal the top card of your Main Deck. If it's a
 *  spell, put it in your hand. Otherwise, recycle it."
 *
 * Status rationale (contract §3.1): the defend trigger and the reveal →
 * branch shape are expressible, but the branch discriminator "if it's a
 * spell" is NOT expressible in the frozen IR:
 * - Condition compare operators are eq/ne/lt/lte/gt/gte/in, and "in" tests
 *   whether the LEFT value is a member of the RIGHT array; a card's types is
 *   an array, so "types contains spell" cannot be stated (there is no
 *   contains operator and no predicate-testing expression);
 * - effect.reveal links only object refs ("revealed"); no type snapshot is
 *   captured, and object-property reads on the revealed ref would re-read the
 *   CURRENT card, which is fine for type (it is still the same deck card at
 *   resolution time) but the membership test above is the real gap.
 *
 * The instructions below preserve the full intended structure (reveal →
 * mode-gated to-hand / recycle on the revealed card) so downstream checkers
 * can see the trigger, timing and linked targets; execution is judged.
 */
export default {
  canonicalCardId: "card.hash-5a86b358540e9ab2512400c77f3291739c2aa6ccb7b537449298a640b02b0e82",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "The branch discriminator 'if it\'s a spell' is not expressible: Condition has no array-contains operator (only eq/ne/lt/lte/gt/gte/in, where in tests left-in-right), so the revealed card's types array cannot be tested for 'spell' without inventing semantics; effect.reveal also links only refs, not type snapshots.",
  sourceText:
    "When you defend here, reveal the top card of your Main Deck. If it's a spell, put it in your hand. Otherwise, recycle it.",
  abilities: [
    {
      kind: "triggered",
      trigger: { at: "defense-declared", filter: { event: "defense-declared", here: true, player: "controller" } },
      optional: false,
      body: [
        {
          id: "ravenbloom.reveal",
          op: "effect.reveal",
          args: { count: { kind: "constant", value: 1 } }
        },
        {
          id: "ravenbloom.mode",
          op: "choice.mode",
          linkedTo: "ravenbloom.reveal",
          args: {
            modes: {
              kind: "constant",
              value: [
                { id: "ravenbloom.spell-mode", body: [] },
                { id: "ravenbloom.other-mode", body: [] }
              ]
            }
          }
        },
        {
          id: "ravenbloom.to-hand",
          op: "effect.zone",
          linkedTo: "ravenbloom.mode",
          args: {
            pick: { kind: "constant", value: "ravenbloom.revealed-card" },
            to: { kind: "constant", value: "hand" },
            amount: { kind: "constant", value: 1 }
          },
          picks: [
            {
              id: "ravenbloom.revealed-card",
              options: [{ kind: "linked-value", instructionId: "ravenbloom.reveal", key: "revealed" }],
              min: 1,
              max: 1,
              selection: "one"
            }
          ],
          condition: {
            kind: "compare",
            left: { kind: "linked-value", instructionId: "ravenbloom.mode", key: "value" },
            operator: "eq",
            right: { kind: "constant", value: ["ravenbloom.spell-mode"] }
          }
        },
        {
          id: "ravenbloom.recycle",
          op: "effect.recycle",
          linkedTo: "ravenbloom.mode",
          args: {
            objects: { kind: "linked-value", instructionId: "ravenbloom.reveal", key: "revealed" }
          },
          condition: {
            kind: "compare",
            left: { kind: "linked-value", instructionId: "ravenbloom.mode", key: "value" },
            operator: "eq",
            right: { kind: "constant", value: ["ravenbloom.other-mode"] }
          }
        }
      ]
    }
  ]
} satisfies CardProgram;

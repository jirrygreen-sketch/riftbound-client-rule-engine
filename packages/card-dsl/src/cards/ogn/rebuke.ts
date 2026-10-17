import type { CardProgram } from "../../ir/index.js";

/**
 * Rebuke (ogn-172-298) — Spell, 2 energy + 2 Chaos Power, Chaos.
 *
 * Printed text:
 *   [Action] (Play on your turn or in showdowns.)
 *   Return a unit at a battlefield to its owner's hand.
 *
 * Modeling notes (Core Rules v1.5):
 * - `action` keeps the printed [Action] keyword (806; 159.2.a); its
 *   `continuous.timing` expansion and the chain admission are owned by the
 *   keyword registry and chain/ (contract 3.7).
 * - The unit is a plain target (355.7 / 355.9.a.1); "at a battlefield" is a
 *   targeting restriction on that unit rather than a second target
 *   (355.10.b), recorded as `location: "battlefield"` (the frozen ObjectFilter
 *   spelling: events/trigger-spec.ts `location?: string`, consumed by
 *   layers/filter.ts as either the location name or an exact Location).
 * - The instruction is the merged effect.zone primitive ("return … to its
 *   owner's hand" — a zone change, 448.2); the action layer routes the object
 *   to its OWNER's hand (108.1 / 359.3.e.9's "returns the friendly unit to its
 *   owner's hand").
 * - CR 359.3.e.9's Rebuke example: if the chosen unit leaves the battlefield
 *   (here: moves to its Base) before resolution, the choice is Mistargeted and
 *   the instruction does not execute. Re-verification of the locked target
 *   against the declared filter is the TargetPlan's job
 *   (target/target-plan.ts resolveTargetPlan); the primitive drops references
 *   that are no longer valid at all (359.3.e.6-e.8), which the golden test
 *   checks.
 * - Printed cost (2 Energy plus 2 Chaos Power) is bound from the card identity
 *   at Finalize (356.1.c); the program declares no CostSpec instead of
 *   re-stating printed values.
 *
 * Status: executable — every printed piece has a merged, executable path and
 * real execution evidence:
 * - the [Action] permission is declared as a keyword ability; Action.ts
 *   expands it to `continuous.timing` (806.1.c / 159.2.a) and the merged
 *   layers/rules query consumes the grant (`actionTimings` / `canAct`,
 *   RIFT-259): off-turn Showdown admission is decidable from the registration;
 * - the return instruction executes on the merged effect.zone primitive and
 *   routes the unit to its OWNER's hand (108.1);
 * - the 359.3.e.9 Rebuke example works end to end: the TargetPlan resolve
 *   re-checks the locked target against the declared battlefield filter, so a
 *   unit that moved to its Base after Finalize is Mistargeted and the
 *   instruction is ignored (verified by the golden test).
 * The card-program -> ChainDraft adapter (chain/engine.ts describePlay) is
 * still coordinator-owned integration wiring, the same status as for the
 * other merged spell cards (ogn/void-seeker.ts, ogn/challenge.ts).
 */
const rebuke = {
  canonicalCardId: "card.hash-b729f880ae397e8eedd9b1e93aaab464d98abc273a98ec06ba2e03bf7c0c97a6",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      body: [
        {
          id: "rebuke.return-unit",
          op: "effect.zone",
          args: {
            target: { kind: "constant", value: "rebuke.unit-at-battlefield" },
            to: { kind: "constant", value: "hand" },
            amount: { kind: "constant", value: 1 }
          },
          targets: [
            {
              id: "rebuke.unit-at-battlefield",
              filter: { type: "unit", zone: "board", location: "battlefield" },
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
    "Return a unit at a battlefield to its owner's hand."
} satisfies CardProgram;

export default rebuke;

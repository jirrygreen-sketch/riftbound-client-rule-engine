import type { CardProgram } from "../../ir/index.js";

/**
 * Against the Odds (sfd-001-221) — Spell, 2 Energy, no printed Power, Fury.
 *
 * Printed text:
 *   [Reaction] (Play any time, even before spells and abilities resolve.)
 *   Give a friendly unit at a battlefield +2 :rb_might: this turn for each
 *   enemy unit there.
 *
 * Catalog evidence (packages/card-data/data/deck-catalog.json, sfd-001-221):
 * cardType Spell, domains ["Fury"], energy 2, power null, might null, tags [].
 * power null means no printed Power and is never rewritten as 0.
 *
 * Modeling notes (Core Rules v1.5):
 * - [Reaction] (813) is a Permissive keyword: 159.2.b grants the Closed-State
 *   play permission. The card declares the keyword only; the permission itself
 *   is owned by the keyword registry and the chain's timing query (contract
 *   3.5/3.7).
 * - "a friendly unit at a battlefield" is a Choice of a specific Game Object in
 *   a Public zone, so the unit is Targeted (355.5, 355.7, 355.10.a); "at a
 *   battlefield" is a targeting restriction on that unit and does not target a
 *   battlefield (355.10.b). It is expressed with the merged filter key
 *   location: "battlefield" (layers/filter.ts compares that key with the
 *   snapshot's location.type); the TargetSpec-level location field is not used,
 *   because it pins a concrete battlefield id for same-location checks
 *   (engine-core/src/target/target-plan.ts). "friendly" is the controller
 *   relationship spelled controller: "self"; the chain's query path normalizes
 *   it to the ability controller (chain/engine.ts).
 * - "for each enemy unit there" is a set count, not a choice: the enemy units
 *   are programmatically selected by characteristics and by the chosen unit's
 *   location, so they are not targets (355.10.d, 355.10.d.1). The count is read
 *   at resolution through a condition.value instruction (359.3.f.2) so the
 *   grant consumes an evaluated integer, and the printed "+2 for each" is the
 *   merged arithmetic multiply (see the instruction comments).
 * - "+2 :rb_might: this turn" is a temporary Might modification: 143.2.a /
 *   433.1.a modulate Might in the arithmetic layer, and 317.2.c expires all
 *   "this turn" effects in the end-of-turn cleanup. It is not a Buff: 702 makes
 *   Buffs counters, and effect.buff's own header states temporary Might changes
 *   "belong to continuous.might, never to this primitive".
 *
 * Status: executable. The two-step read (+2 x enemy count) and the grant run on
 * merged primitives: condition.value evaluates the count expression with the
 * sameLocationAs anchor at resolution, continuous.might registers
 * the arithmetic-layer modification from the linked value with the end-of-turn
 * duration (478.1.a), and the layers engine evaluates and expires it (317.2.c).
 * The golden test drives the card's own body through the production chain
 * adapter (chain/interpreter-adapter.ts) and asserts the per-enemy amount, the
 * registered modification, the expiry, the zero-enemy no-op and the stale
 * target branch.
 */
export default {
  canonicalCardId: "card.hash-ce4f294fc93a34896d001feda8ba9d15d051f2ea01bf0c84a56036243102b3fa",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    { kind: "keyword", keyword: "reaction" },
    {
      kind: "play",
      // Printed cost (2 Energy, no Power) comes from the catalog; the Finalize
      // cost plan is its consumer.
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 2 }
      },
      body: [
        {
          // "+2 Might ... for each enemy unit there": read the count at
          // resolution (359.3.f.2) and multiply it by the printed 2. The
          // instruction form is required because continuous.might's args schema
          // validates an amount before evaluating it and accepts only
          // constant/literal/object/linked/count expressions, not a bare
          // arithmetic node; the interpreter evaluates this body node and the
          // grant consumes the linked integer.
          id: "against-the-odds.count-enemies",
          op: "condition.value",
          args: {
            operands: {
              kind: "constant",
              value: [
                { kind: "constant", value: 2 },
                {
                  kind: "count",
                  subject: "enemy-units-at-the-chosen-unit",
                  filter: {
                    type: "unit",
                    controller: "opponent",
                    sameLocationAs: { target: "against-the-odds.unit" }
                  }
                }
              ]
            },
            operator: { kind: "constant", value: "multiply" },
            key: { kind: "constant", value: "enemyCount" }
          },
          targets: [
            {
              id: "against-the-odds.unit",
              filter: { type: "unit", controller: "self", location: "battlefield" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          // "Give a friendly unit ... +2 Might this turn for each enemy unit
          // there": one temporary Might modification registered in the
          // arithmetic layer by the merged continuous.might primitive,
          // ending at cleanup (317.2.c). The chosen unit is a
          // target (355.5/355.7/355.10.a) whose "at a battlefield" restriction
          // is a filter key (355.10.b), not a second target.
          id: "against-the-odds.grant-might",
          op: "continuous.might",
          linkedTo: "against-the-odds.count-enemies",
          args: {
            objects: { kind: "constant", value: { kind: "target", id: "against-the-odds.unit" } },
            amount: {
              kind: "linked-value",
              instructionId: "against-the-odds.count-enemies",
              key: "enemyCount"
            },
            duration: { kind: "constant", value: "this-turn" }
          }
        }
      ]
    }
  ],
  sourceText:
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "Give a friendly unit at a battlefield +2 :rb_might: this turn for each enemy unit there."
} satisfies CardProgram;

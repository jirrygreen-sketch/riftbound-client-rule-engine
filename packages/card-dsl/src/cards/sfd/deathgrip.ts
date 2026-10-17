import type { CardProgram } from "../../ir/index.js";

/**
 * Deathgrip (sfd-163-221) — Spell, 2 energy, Order.
 *
 * Printed text:
 *   [Reaction] (Play any time, even before spells and abilities resolve.)
 *   Kill a friendly unit to give +:rb_might: equal to its Might to another
 *   friendly unit this turn. Draw 1.
 *
 * Modeling notes (Core Rules v1.5):
 * - [Reaction] (813) is declared as a keyword ability; the timing permission
 *   itself is owned by effects/keywords/Reaction.ts and the chain module.
 * - "Kill a friendly unit" is a cost within the instruction (355.10.c.1,
 *   "[do X] to [do Y]"): it is not a target selection, so the killed unit is
 *   a non-target pick. The kill is executed with the merged effect.kill
 *   primitive through its `picks` argument (429.1 / 429.6).
 * - "give +[M] equal to its Might to another friendly unit this turn" is a
 *   temporary Might modification of a target, sized by the killed unit's
 *   Might. The amount is read in two steps: a condition.value instruction
 *   reads `might` off the object effect.kill linked (359.3.e.13 / look-back),
 *   then the merged continuous.might primitive (RIFT-258) receives that
 *   value through a linked-value Expr and registers the arithmetic-layer
 *   effect with the end-of-turn duration (478/478.1.a, 317.1.a).
 * - "Draw 1." is a separate sentence and stays unlinked: it still happens when
 *   the Might grant cannot (359.3.e.11 / 359.3.e.14.b).
 *
 * Status: executable. The kill cost, the linked Might read, the Might grant
 * and the independent draw all execute on merged primitives; the golden test
 * drives the card's own body through the production chain adapter and asserts
 * the kill, the look-back amount, the registered arithmetic-layer
 * modification, the exclude restriction and the unlinked draw.
 */
const deathgrip = {
  canonicalCardId: "card.hash-1f41363528139c43d205b49bf3880604480befbe9f8d033db61f0618cecdf389",
  rulesetVersion: "core-1.5",
  status: "executable",
  sourceText:
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "Kill a friendly unit to give +:rb_might: equal to its Might to another friendly unit this turn. Draw 1.",
  abilities: [
    { kind: "keyword", keyword: "reaction" },
    {
      kind: "play",
      body: [
        {
          // "Kill a friendly unit to ...": the cost half of 355.10.c.1, read
          // as a non-target pick and submitted through effect.kill.
          id: "deathgrip.kill",
          op: "effect.kill",
          args: { picks: { kind: "constant", value: "deathgrip.fodder" } },
          picks: [
            {
              id: "deathgrip.fodder",
              options: ["friendly-unit-you-control"],
              min: 1,
              max: 1,
              selection: "one",
              // "friendly": the ability controller (740.1.a); "self" is the
              // PlayerSelector spelling the merged chain query normalizes
              // (chain/engine.ts).
              filter: { type: "unit", controller: "self" }
            }
          ]
        },
        {
          // "... equal to its Might": read the killed unit's last-known Might
          // once (359.3.e.13 look-back through the kill's linked `killed`
          // reference) so the grant below can consume it as a linked value.
          id: "deathgrip.read-killed-might",
          op: "condition.value",
          linkedTo: "deathgrip.kill",
          args: {
            value: {
              kind: "object-property",
              object: { linked: "deathgrip.kill" },
              property: "might"
            },
            key: { kind: "constant", value: "killedMight" }
          }
        },
        {
          // "give +[M] equal to its Might to another friendly unit this turn" —
          // a temporary Might modification registered in the arithmetic layer
          // by the merged continuous.might primitive (RIFT-258), ending at
          // cleanup (317.2.c).
          id: "deathgrip.grant-might",
          op: "continuous.might",
          linkedTo: "deathgrip.read-killed-might",
          args: {
            objects: {
              kind: "constant",
              value: { kind: "target", id: "deathgrip.gifted-unit" }
            },
            amount: {
              kind: "linked-value",
              instructionId: "deathgrip.read-killed-might",
              key: "killedMight"
            },
            duration: { kind: "constant", value: "this-turn" }
          },
          targets: [
            {
              id: "deathgrip.gifted-unit",
              // "another friendly unit": the killed unit is excluded through
              // the documented `exclude` anchor (contract 3.6 selectors).
              filter: {
                type: "unit",
                controller: "self",
                exclude: { pick: "deathgrip.fodder" }
              },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          // "Draw 1." — a separate sentence, deliberately not linked to the
          // Might instruction (359.3.e.11: resolve as much as possible).
          id: "deathgrip.draw",
          op: "effect.draw",
          args: { amount: { kind: "constant", value: 1 } }
        }
      ]
    }
  ]
} satisfies CardProgram;

export default deathgrip;

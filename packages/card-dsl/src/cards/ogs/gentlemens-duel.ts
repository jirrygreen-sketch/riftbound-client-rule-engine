import type { CardProgram } from "../../ir/index.js";

/**
 * Gentlemen's Duel (ogs-008-024) — Spell, 6 energy + 1 Body power (Body).
 *
 * Printed text:
 *   [Action] (Play on your turn or in showdowns.)
 *   Give a friendly unit +3 :rb_might: this turn. Then choose an enemy unit.
 *   They deal damage equal to their Mights to each other.
 *
 * Modeling notes (Core Rules v1.5):
 * - [Action] (806) is declared as a keyword ability; the registry owns the
 *   Showdown permission (806.1.b/806.1.c, 159.2.a).
 * - "Give a friendly unit +3 [M] this turn" is a temporary continuous Might
 *   modification: it is not a Buff (702: a Buff counter is not a Might value
 *   change) and it expires at the end of the turn (continuous.might with an
 *   end-of-turn duration).
 * - "Then choose an enemy unit" is a targeting choice, not the 388.1 reflexive
 *   "do this" marker: both objects are chosen while this spell is finalized on
 *   the chain (355.5, 355.7), so the friendly unit and the enemy unit are
 *   TargetSpecs of this program.
 * - "They deal damage equal to their Mights to each other" is two Deal actions
 *   whose source is the unit, not this spell (418.6.b.3), and whose amounts are
 *   read at execution time (359.3.f.2). Both are ordinary effect.damage
 *   instructions: one with the friendly unit as source and amount, one with the
 *   enemy unit as source and amount. 418.1.d allows damage to more than one unit
 *   at the same time, and the whole spell finishes resolving before cleanup, so
 *   neither instruction is skipped because the other already dealt lethal
 *   damage (158.3.a, 323.4). The +3 Might grant and the first Deal are separate
 *   instructions executed top to bottom (359.3.d) with no reference between
 *   them, so they are not linked. The two Deals do reference each other ("they
 *   deal damage equal to their Mights to each other" reads both units), so the
 *   second is linked to the first: a first Deal that is ignored also ignores the
 *   second (359.3.e.14.a).
 *
 * Status: executable — every half executes on merged paths and the golden test
 * drives the card's own body through the production chain adapter:
 * - the +3 Might grant is the merged continuous.might primitive (RIFT-258),
 *   registering one arithmetic-layer effect for the locked friendly unit through
 *   ResolveContext.addContinuous with the end-of-turn duration (317.1.a /
 *   468.7.c); the target is read with the `objects: { kind: "target", id }`
 *   selector form the primitive evaluates itself (355.10.g);
 * - the two Deals run with the unit itself as source (418.6.b.3) and read its
 *   post-grant Might at execution time (359.3.f.2), so the amounts are never
 *   rewritten to the spell or to fixed numbers;
 * - the second Deal stays linked to the first (359.3.e.14.a): an ignored first
 *   Deal also ignores the second, exercised by the golden.
 */
const gentlemensDuel = {
  canonicalCardId: "card.hash-2837500ae259cc6b529efd728cf65b05c957555d4e133c0d55310df08cf1b7d7",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 6 },
        power: { kind: "constant", value: 1 }
      },
      body: [
        {
          // "Give a friendly unit +3 [M] this turn" — the merged
          // continuous.might primitive registers the arithmetic-layer effect
          // for the locked target with the end-of-turn duration. The chosen
          // unit is a target (355.7); the primitive reads it through the
          // `objects` target selector (355.10.g), not through a bare
          // `target` spec-id argument.
          id: "gentlemens-duel.give-plus-3-might",
          op: "continuous.might",
          args: {
            amount: { kind: "constant", value: 3 },
            duration: { kind: "constant", value: "end-of-turn" },
            objects: {
              kind: "constant",
              value: { kind: "target", id: "gentlemens-duel.friendly-unit" }
            }
          },
          targets: [
            {
              id: "gentlemens-duel.friendly-unit",
              filter: { type: "unit", controller: "self" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          // "They deal damage equal to their Mights to each other." First half:
          // the friendly unit deals damage equal to its Might (418.6.b.3: the
          // unit is the source, read with the { target } selector; the amount is
          // the unit's current Might, read on execution per 359.3.f.2). "Then
          // choose an enemy unit" declares the second target here.
          id: "gentlemens-duel.friendly-unit-strikes",
          op: "effect.damage",
          args: {
            amount: {
              kind: "object-property",
              object: { target: "gentlemens-duel.friendly-unit" },
              property: "might"
            },
            source: {
              kind: "object-property",
              object: { target: "gentlemens-duel.friendly-unit" },
              property: "ref"
            },
            target: { kind: "constant", value: "gentlemens-duel.enemy-unit" }
          },
          targets: [
            {
              id: "gentlemens-duel.enemy-unit",
              filter: { type: "unit", controller: "opponent" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          // Second half: the enemy unit deals damage equal to its Might back.
          // Linked to the first Deal so a mistargeted friendly unit ignores this
          // instruction too (359.3.e.14.a).
          id: "gentlemens-duel.enemy-unit-strikes",
          op: "effect.damage",
          linkedTo: "gentlemens-duel.friendly-unit-strikes",
          args: {
            amount: {
              kind: "object-property",
              object: { target: "gentlemens-duel.enemy-unit" },
              property: "might"
            },
            source: {
              kind: "object-property",
              object: { target: "gentlemens-duel.enemy-unit" },
              property: "ref"
            },
            target: { kind: "constant", value: "gentlemens-duel.friendly-unit" }
          }
        }
      ]
    }
  ],
  sourceText:
    "[Action] (Play on your turn or in showdowns.)\n" +
    "Give a friendly unit +3 :rb_might: this turn. Then choose an enemy unit. They deal damage equal to their Mights to each other."
} satisfies CardProgram;

export default gentlemensDuel;

import type { CardProgram } from "../../ir/index.js";

/**
 * Last Breath, Yasuo (ogn-260-298) — Spell, 3 energy + 2 Calm power (Calm/Chaos).
 *
 * Printed text:
 *   [Action] (Play on your turn or in showdowns.)
 *   Ready a friendly unit. It deals damage equal to its Might to an enemy unit
 *   at a battlefield.
 *
 * Modeling notes (Core Rules v1.5):
 * - [Action] (806 / 159.2.a) is a keyword ability; the card only declares it and
 *   the keyword registry expands it (contract 3.7). Chain timing admission
 *   (canAct) is engine work, exactly as for the merged Void Seeker program.
 * - "Ready a friendly unit." is a Choice (355.5 / 355.7), so the unit is a
 *   TargetSpec, not a pick. effect.ready submits "ready" and reports 416.1.b /
 *   416.1.c (an already-ready unit produces no event and count 0) without
 *   failing the instruction.
 * - "It deals damage equal to its Might to an enemy unit at a battlefield."
 *   The readied unit is the damage source (418.6.b.3), so `source` reads that
 *   unit's zone-bound ref through an object-property expression; the amount is
 *   read at resolution (contract 3.6 evaluate timing), and the damage target is
 *   "an enemy unit at a battlefield" (355.9.b: the units are the targets and
 *   "at a battlefield" is their targeting restriction).
 * - Filter vocabulary: `controller: "self"` is the resolving ability's
 *   controller and `location: "battlefield"` is the location-type spelling the
 *   merged engine filter accepts (chain/engine.ts normalizes "self";
 *   layers/filter.ts compares `location` against either an exact LocationRef or
 *   the location type). The reference test kernel does not model those two
 *   predicates, so the golden test locks targets the way Finalize does and
 *   executes the real primitives instead of matching the filter itself.
 * - The second sentence resumes the first sentence's subject, so the damage
 *   instruction is linked to the ready instruction: losing the friendly unit
 *   ignores the follow-up too (contract 3.4 / 3.9, CR 359.3.e).
 */
const lastBreath = {
  canonicalCardId: "card.hash-adadfbd360eec79d9a637667e3d360e2baf6b619cf07ad535bf57a5e10ed3d86",
  rulesetVersion: "core-1.5",
  status: "executable",
  sourceText:
    "[Action] (Play on your turn or in showdowns.)\n" +
    "Ready a friendly unit. It deals damage equal to its Might to an enemy unit at a battlefield.",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      body: [
        {
          id: "ready-friendly-unit",
          op: "effect.ready",
          args: {
            // effect.ready takes a primitive-level selection descriptor; the
            // merged corpus writes the TargetSpec id as { kind: "target", id }
            // (see sfd/veiled-temple.ts), which the production interpreter
            // adapter path hands to the primitive unchanged.
            objects: { kind: "constant", value: { kind: "target", id: "friendly-unit" } }
          },
          targets: [
            {
              id: "friendly-unit",
              // "a friendly unit" — a Choice (355.5), not a pick (355.10).
              filter: { type: "unit", controller: "self" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          id: "damage-enemy-unit",
          op: "effect.damage",
          linkedTo: "ready-friendly-unit",
          args: {
            // "equal to its Might" — read at resolution (contract 3.6).
            amount: {
              kind: "object-property",
              object: { target: "friendly-unit" },
              property: "might"
            },
            // "It deals ..." — the readied unit, not the spell, is the source
            // (CR 418.6.b.3). The static IR has no runtime ObjectRef, so the
            // zone-bound ref is read through object-property (ObjectSnapshot.ref).
            source: {
              kind: "object-property",
              object: { target: "friendly-unit" },
              property: "ref"
            },
            target: { kind: "constant", value: "enemy-unit-at-battlefield" }
          },
          targets: [
            {
              id: "enemy-unit-at-battlefield",
              filter: { type: "unit", controller: "opponent", location: "battlefield" },
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

export default lastBreath;

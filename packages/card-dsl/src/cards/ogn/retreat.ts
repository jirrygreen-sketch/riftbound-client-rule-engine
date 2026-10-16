import type { CardProgram } from "../../ir/index.js";

/**
 * Retreat (ogn-104-298) — Spell, 1 energy, Mind.
 *
 * Printed text:
 *   [Reaction] (Play any time, even before spells and abilities resolve.)
 *   Return a friendly unit to its owner's hand. Its owner channels 1 rune
 *   exhausted.
 *
 * Modeling notes (Core Rules v1.5):
 * - `keyword: "reaction"` declares the printed [Reaction] permission (813 /
 *   159.2.b). Admission itself is chain-owned (`chain/engine.ts#canAct` plus
 *   the draft's speed); the keyword registry expansion (continuous.timing)
 *   feeds the layers timing consumer. This card file only declares the
 *   keyword, as contract 3.7 requires.
 * - "Return a friendly unit to its owner's hand": a unit on the Board is in a
 *   public zone, so the named unit is Targeted (355.7 / 355.9.a.1 / 355.10).
 *   Returns are their own action (416-free: the return-to-hand GameAction),
 *   which `effect.zone` submits for a `to: "hand"` destination.
 * - "Its owner channels 1 rune exhausted": `effect.channel` reads the channeler
 *   from an Expr. The channeler is the returned unit's *owner*, which is
 *   owner-routed (108.6 / 417.1.c): every player channels from their own Rune
 *   Deck. The owner is read from the target snapshot; when the return action
 *   invalidated that reference in this body, the interpreter's 359.3.e.13
 *   look-back supplies the last known information (owner never changes with
 *   zone). The instruction is linked to the return so an ignored return also
 *   ignores the channel (its "Its owner" reference is then unavailable).
 * - Channeled-exhausted entry is the printed stipulation (431.2). A short Rune
 *   Deck still channels as many as possible without negating (431.3), which the
 *   golden test exercises.
 */
const retreat = {
  canonicalCardId: "card.hash-e6e5c4f19dfe34b964bd6348cc46c60d1d565fb1949561f4c5c749101ed39bcf",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    { kind: "keyword", keyword: "reaction" },
    {
      kind: "play",
      body: [
        {
          id: "return-unit",
          op: "effect.zone",
          args: {
            target: { kind: "constant", value: "friendly-unit" },
            to: { kind: "constant", value: "hand" }
          },
          targets: [
            {
              id: "friendly-unit",
              filter: { type: "unit", controller: "self" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          id: "channel-rune",
          op: "effect.channel",
          linkedTo: "return-unit",
          args: {
            player: {
              kind: "object-property",
              object: { target: "friendly-unit" },
              property: "owner"
            },
            amount: { kind: "constant", value: 1 },
            exhausted: { kind: "constant", value: true }
          }
        }
      ]
    }
  ],
  sourceText:
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "Return a friendly unit to its owner's hand. Its owner channels 1 rune exhausted."
} satisfies CardProgram;

export default retreat;

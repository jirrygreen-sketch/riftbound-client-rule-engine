import type { CardProgram } from "../../ir/index.js";


/**
 * Stupefy (ogn-095-298) — Spell, 1 energy, Mind.
 *
 * Printed text:
 *   [Reaction] (Play any time, even before spells and abilities resolve.)
 *   Give a unit -1 :rb_might: this turn, to a minimum of 1 :rb_might:. Draw 1.
 *
 * Modeling notes (Core Rules v1.5):
 * - [Reaction] (813) is declared as a keyword ability only; its timing
 *   permission is chain-owned (canAct plus the draft's speed), not per-card
 *   behaviour (contract 3.5 / 3.7).
 * - "a unit" is a target: the named Board unit is in a public zone (355.7 /
 *   355.9.a.1 / 355.10).
 * - "-1 Might this turn, to a minimum of 1 Might" is an arithmetic-layer Might
 *   modification with a per-turn duration (143.2.a: "Might" means Effective
 *   Might; 478/479 layers) executed by the merged continuous.might primitive
 *   (RIFT-258). The primitive registers one arithmetic-layer effect through
 *   ResolveContext.addContinuous with the end-of-turn duration
 *   (317.1.a / 468.7.c).
 * - The floor is the printed minimum, not the generic 143.2.c "below 0 is
 *   treated as 0" rule: 479.4.b snapshots the limitation when the effect is
 *   applied, so the primitive carries it as effect.minimum and snaps the delta
 *   against the target's current Might (a 4-Might unit given -1 receives -1; a
 *   1-Might unit snapshots to a 0-Might modification and stays at 1).
 * - "Draw 1." is a separate, unlinked instruction: the draw is not conditioned
 *   on the debuff, so it still resolves when the debuff cannot (359.2.c "as
 *   much as possible"; 359.3.e.14 linked instructions only cover anaphoric
 *   references, which this sentence has none of).
 *
 * Status: executable — the whole printed ability executes on merged paths and
 * the golden test drives the card's own body through the production chain
 * adapter, asserting the arithmetic-layer registration, the end-of-turn
 * duration, the printed minimum boundary, the independent draw and the
 * mistargeted edge.
 */
const stupefy = {
  canonicalCardId: "card.hash-5b08b5b8648e8c5c057d15279d1b4e677457eb0b43fcf2810e2ec4f4c4d1b7cf",
  rulesetVersion: "core-1.5",
  status: "executable",
  sourceText:
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "Give a unit -1 :rb_might: this turn, to a minimum of 1 :rb_might:. Draw 1.",
  abilities: [
    { kind: "keyword", keyword: "reaction" },
    {
      kind: "play",
      body: [
        {
          // "Give a unit -1 Might this turn, to a minimum of 1 Might": the
          // merged continuous.might primitive registers one arithmetic-layer
          // effect per resolved object with the end-of-turn duration and the
          // printed minimum snapshotted (479.4.b).
          id: "debuff",
          op: "continuous.might",
          args: {
            amount: { kind: "literal", value: -1 },
            duration: { kind: "literal", value: "this-turn" },
            minimum: { kind: "literal", value: 1 },
            objects: { kind: "literal", value: { kind: "target", id: "unit" } }
          },
          targets: [
            { id: "unit", filter: { type: "unit", zone: "board" }, min: 1, max: 1, selection: "one" }
          ]
        },
        {
          // "Draw 1." — independent instruction (not linkedTo the debuff), so the
          // 359.2.c "as much as possible" case still draws.
          id: "draw",
          op: "effect.draw",
          args: { amount: { kind: "literal", value: 1 } }
        }
      ]
    }
  ]
} satisfies CardProgram;

export default stupefy;

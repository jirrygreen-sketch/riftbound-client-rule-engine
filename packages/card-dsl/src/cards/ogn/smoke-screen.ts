import type { CardProgram } from "../../ir/index.js";

/**
 * Smoke Screen (ogn-093-298) — Spell, 2 energy + 1 power, Mind.
 *
 * Printed text (packages/card-data/data/deck-catalog.json, ogn-093-298):
 *   [Reaction] (Play any time, even before spells and abilities resolve.)
 *   Give a unit -4 :rb_might: this turn, to a minimum of 1 :rb_might:.
 *
 * Modeling notes (Core Rules v1.5):
 * - [Reaction] (813) is declared as a keyword ability only; the permission
 *   (813.1.b/813.1.c: any player's turn, Closed States, plus every Action
 *   timing) is expanded by effects/keywords/Reaction.ts and enforced by the
 *   chain's own timing check (contract 3.5 / 3.7).
 * - "a unit" is a target: the named Board unit is in a public zone (355.7 /
 *   355.9.a.1 / 355.10).
 * - "-4 Might this turn, to a minimum of 1 Might" is an arithmetic-layer Might
 *   modification with a per-turn duration (143.2.a: "Might" means Effective
 *   Might; 475/478 layers) executed by the merged continuous.might primitive
 *   (RIFT-258). The primitive registers one arithmetic-layer effect through
 *   ResolveContext.addContinuous with the end-of-turn duration
 *   (317.1.a / 468.7.c).
 * - The floor is the printed minimum, not the general 143.2.c "less than 0 is
 *   treated as 0" rule: 479.4.b snapshots the limitation when the effect is
 *   applied, so the primitive carries it as effect.minimum and snaps the delta
 *   against the target's current Might (a 6-Might unit given -4 to a minimum of
 *   1 receives exactly -4; a 2-Might unit receives -1 and stays at 1).
 *
 * Status: executable — the whole printed ability executes on merged paths and
 * the golden test drives the card's own body through the production chain
 * adapter, asserting the arithmetic-layer registration, the end-of-turn
 * duration, the printed minimum boundary and the mistargeted edge.
 */
const smokeScreen = {
  canonicalCardId: "card.hash-e97af51e4273d0e357336eeb9843588d53ddb174bbf2fe8c0ce001f8f5cc3674",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    { kind: "keyword", keyword: "reaction" },
    {
      kind: "play",
      body: [
        {
          id: "smoke-screen.debuff",
          op: "continuous.might",
          args: {
            amount: { kind: "constant", value: -4 },
            duration: { kind: "constant", value: "this-turn" },
            // The printed clamp (479.4.b). The merged primitive snapshots it
            // into effect.minimum; the layer engine's generic 0 floor is not
            // this card's limit.
            minimum: { kind: "constant", value: 1 },
            objects: { kind: "constant", value: { kind: "target", id: "smoke-screen.unit" } }
          },
          targets: [
            {
              id: "smoke-screen.unit",
              filter: { type: "unit" },
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
    "Give a unit -4 :rb_might: this turn, to a minimum of 1 :rb_might:."
} satisfies CardProgram;

export default smokeScreen;

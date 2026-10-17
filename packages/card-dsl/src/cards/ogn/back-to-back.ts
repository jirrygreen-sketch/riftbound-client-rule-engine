import type { CardProgram } from "../../ir/index.js";

/**
 * Back to Back — ogn-206-298 (Spell, Order, 3 Energy, no Power).
 *
 * Printed text (packages/card-data/data/deck-catalog.json, ogn-206-298):
 *   [Reaction] (Play any time, even before spells and abilities resolve.)
 *   Give two friendly units each +2 :rb_might: this turn.
 *
 * Modeling notes (Core Rules v1.5):
 * - "[Reaction]" (813) is a permissive keyword expanded by the keyword
 *   registry (effects/keywords/Reaction.ts) into a continuous.timing static
 *   ability; the card only names it.
 * - "two friendly units" is one target group of exactly two units (355.9.b
 *   "unit you control"). The printed count is fixed, so the TargetSpec pins
 *   min: 2 / max: 2; it is not "up to" (355.13 would allow zero). Finalize
 *   rejects the card when fewer than two friendly units are available.
 * - "each +2 :rb_might: this turn" is a temporary Might modification executed
 *   by the merged continuous.might primitive (RIFT-258): it registers one
 *   arithmetic-layer effect per resolved object through
 *   ResolveContext.addContinuous with the end-of-turn duration
 *   (317.2.c "3d. All 'this turn' effects expire simultaneously."; 317.1.a /
 *   468.7.c, layers/ops resolveContinuousDuration). effect.buff is not used —
 *   703 Buffs are counters, not a Might modification.
 *
 * Status: executable — the whole printed ability executes on merged paths. The
 * golden test drives the card's own body through the interpreter, the merged
 * target system and the layer engine, asserting the 2/2 target bounds, the two
 * arithmetic-layer registrations, the +2 effective Might per unit, the
 * end-of-turn expiry and the stale-target edge. The [Reaction] permission's
 * chain admission stays engine work recorded in test.todo, exactly as in the
 * other merged keyword cards (cf. ogn/grove-of-the-god-willow).
 */
const backToBack = {
  canonicalCardId: "card.hash-da1c2e22f4362a3f4d0eaa86e904a11354020a28a999ebe7cd71d8e76da691d7",
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
          // "Give two friendly units each +2 Might this turn" — the merged
          // continuous.might primitive registers one arithmetic-layer effect
          // per resolved object (478/478.1.a) with the end-of-turn duration
          // (317.2.c expiry).
          id: "back-to-back.grant-might",
          op: "continuous.might",
          args: {
            amount: { kind: "constant", value: 2 },
            duration: { kind: "constant", value: "this-turn" },
            objects: {
              kind: "constant",
              value: { kind: "target", id: "back-to-back.units" }
            }
          },
          targets: [
            {
              id: "back-to-back.units",
              // "friendly units" = units the ability controller controls; the
              // merged chain query normalizes the "self" player selector
              // against the item's controller (the merged on-the-hunt /
              // siphon-power spelling).
              filter: { type: "unit", zone: "board", controller: "self" },
              min: 2,
              max: 2,
              selection: "any"
            }
          ]
        }
      ]
    }
  ],
  sourceText:
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "Give two friendly units each +2 :rb_might: this turn."
} satisfies CardProgram;

export default backToBack;

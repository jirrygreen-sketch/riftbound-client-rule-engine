import type { CardProgram } from "../../ir/index.js";


/**
 * Danger Zone (sfd-182-221) — Spell, 1 Energy + 1 Power, Rumble signature
 * (Fury/Mind).
 *
 * Official catalog text:
 *   [Reaction] (Play any time, even before spells and abilities resolve.)
 *   [Repeat] :rb_energy_1::rb_rune_rainbow: (You may pay the additional cost
 *   to repeat this spell's effect.)
 *   Give your Mechs +1 :rb_might: this turn.
 *
 * Evidence: Core Rules v1.5 (2026-10-09, effective 2026-10-16),
 * https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf.
 * - 813.1 lets the Reaction card enter a Closed State at Priority. The Chain
 *   Engine owns the response window; the card IR only preserves the keyword.
 * - The printed 1 Power base cost on this multi-domain card is one any-of-
 *   Domains requirement (135.2.e.6.c). The optional Repeat cost is one Energy
 *   and one universal Power (135.2.e.5.a), which the production binder expands
 *   to the six legal Domains. Finalize locks and pays both requirements; the
 *   paid instance causes one additional whole-body execution (820.1.a-d,
 *   820.3.a) without a second card play.
 * - "Give your Mechs +1 Might this turn" programmatically selects each friendly
 *   Mech (355.10.d), so it has no TargetSpec. continuous.might registers
 *   an arithmetic-layer bonus for each selected object, and all "this turn"
 *   effects expire together during the ending cleanup (317.2.c).
 *
 * Status is executable: production bound-play tests cover both cost choices,
 * the legal Reaction window, two real Resolve executions when Repeat is paid,
 * one when declined, end-of-turn expiry, and atomic failure on missing costs.
 */
const dangerZone = {
  canonicalCardId: "card.hash-3c1c01b405853556e3e1c12bbd758e94d73f5ed474a5643bb068eaa7cb549c6e",
  rulesetVersion: "core-1.5",
  status: "executable",
  sourceText:
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "[Repeat] :rb_energy_1::rb_rune_rainbow: (You may pay the additional cost to repeat this spell's effect.)\n" +
    "Give your Mechs +1 :rb_might: this turn.",
  abilities: [
    { kind: "keyword", keyword: "reaction" },
    // Keep the printed keyword identity. The play CostSpec carries its
    // parameter because KeywordAbility has no second, cost-bearing syntax.
    { kind: "keyword", keyword: "repeat" },
    {
      kind: "play",
      // [Repeat] 1 Energy + 1 universal Power (135.2.e.5.a). Keep the printed
      // rainbow identity for the binder to translate into any legal Domain.
      cost: {
        kind: "additional-cost",
        keyword: "repeat",
        optional: true,
        energy: { kind: "literal", value: 1 },
        power: { kind: "literal", value: ["rainbow"] }
      },
      body: [
        {
          // "Give your Mechs +1 Might this turn" — each-set (no TargetSpec),
          // registered for each selected friendly Mech and expiring at ending
          // cleanup.
          id: "buff-mechs",
          op: "continuous.might",
          args: {
            objects: {
              kind: "literal",
              value: {
                kind: "query",
                filter: { type: "unit", tags: ["Mech"], controller: "self", zone: "board" }
              }
            },
            amount: { kind: "literal", value: 1 },
            duration: { kind: "literal", value: "this-turn" }
          }
        }
      ]
    }
  ]
} satisfies CardProgram;

export default dangerZone;

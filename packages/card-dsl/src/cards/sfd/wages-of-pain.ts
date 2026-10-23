import type { CardProgram } from "../../ir/index.js";

/**
 * Wages of Pain — sfd-070-221 (CR v1.5 811.1, 187.5, 184.1/185.2.d).
 *
 * Status: executable, re-verified 2026-10-23 against the merged production
 * path. RIFT-1005 preserves the token Gear's stipulated exhausted entry when
 * the Gold Play resolves (184.1/359.2.d), and RIFT-1007 applies the Hidden
 * destination restriction only to a played Unit (811.1.d.5), leaving this Gold
 * at its controller's Base as instructed while 811.2 keeps other instructions
 * normal. RIFT-987 binds Gold to its canonical 187.5 Reaction Add, and the
 * Hidden Play/private storage/next-turn Reaction path is covered in the card
 * golden alongside the normal production Play.
 */
const wagesOfPain = {
  canonicalCardId: "card.hash-431738fdce44471075e7d0f77a009dde71d56c7be7e2c9ef022d6b124a857a3c",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    { kind: "keyword", keyword: "hidden" },
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      body: [
        {
          id: "deal-3",
          op: "effect.damage",
          args: {
            amount: { kind: "constant", value: 3 },
            target: { kind: "constant", value: "damaged-unit" }
          },
          targets: [
            {
              id: "damaged-unit",
              filter: { type: "unit", location: "battlefield" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          // "Play a Gold gear token exhausted." — the token is created on the
          // Chain, played as a real zero-cost token (185.2.a/185.3.a.1), enters
          // the controller's Base with the explicit 184.1 override, and then
          // binds Gold's canonical 187.5 program through lifecycle attachment.
          id: "play-gold-token",
          op: "effect.token",
          args: {
            token: { kind: "constant", value: "gold" },
            amount: { kind: "constant", value: 1 },
            mode: { kind: "constant", value: "play" },
            location: { kind: "constant", value: { type: "base", player: "controller" } },
            entersExhausted: { kind: "constant", value: true },
            linkKey: { kind: "constant", value: "goldToken" }
          }
        }
      ]
    }
  ],
  sourceText:
    "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
    "[Action] (Play on your turn or in showdowns.)\n" +
    "Deal 3 to a unit at a battlefield. Play a Gold gear token exhausted."
} satisfies CardProgram;

export default wagesOfPain;

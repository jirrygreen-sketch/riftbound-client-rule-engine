import type { CardProgram } from "../../ir/index.js";

/**
 * Premonition — sfd-087-221 (Spell, 2 energy + 3 Mind power, Mind, tags []).
 *
 * Printed text (packages/card-data/data/deck-catalog.json, sfd-087-221, verbatim):
 *   [Reaction] (Play any time, even before spells and abilities resolve.)
 *   Draw 3.
 *
 * Catalog evidence: energy 2, power 3 (Mind), might null, domains ["Mind"], tags [].
 *
 * Modeling notes (Core Rules v1.5):
 * - [Reaction] (813) is a Permissive keyword: 813.1.b grants every Action
 *   permission, 813.1.c adds Closed State play on any player's turn, and 813.3
 *   states that the keyword changes no instruction's function. The card
 *   declares { kind: "keyword", keyword: "reaction" }; the merged KeywordDef
 *   (effects/keywords/Reaction.ts, RIFT-85) owns the continuous.timing
 *   expansion (contract 3.7) and admission is the chain's canAct check
 *   (contract 3.5, 309.1.a, 159.2.b.3).
 * - "Draw 3." is 414.3 "Draw X.": the merged effect.draw submits the draw for
 *   the ability controller by default (190.6.d, 414.1.a) and reads the actual
 *   drawn count, so a short deck draws as many as possible (414.4).
 * - The printed base cost (2 energy + 3 Mind power) is declared from the
 *   catalog so the card is self-describing; the Finalize cost plan is its
 *   consumer (RIFT-89).
 *
 * Status: executable — both printed abilities use merged pieces (the Reaction
 * KeywordDef and a single effect.draw), and the golden test executes the
 * program body against the reference kernel (normal draw plus the short-deck
 * boundary). The whole-source duel template test for Premonition also matches
 * this exact text ("[Reaction] ...\nDraw 3.").
 */
const premonition = {
  canonicalCardId: "card.hash-281e4f29c74b8ba799276e97df9e961d0366cf7c8b6fd6c90bb383574d9f40c5",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    { kind: "keyword", keyword: "reaction" },
    {
      kind: "play",
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 2 },
        power: { kind: "constant", value: 3 }
      },
      body: [
        {
          id: "premonition.draw-3",
          op: "effect.draw",
          args: { amount: { kind: "constant", value: 3 } }
        }
      ]
    }
  ],
  sourceText:
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "Draw 3."
} satisfies CardProgram;

export default premonition;

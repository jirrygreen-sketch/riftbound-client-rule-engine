import type { CardProgram } from "../../ir/index.js";

/**
 * Petricite Monument (sfd-104-221) — Gear, 2 Energy, no printed Power, no Might,
 * Body, no tags.
 *
 * sourceText (verbatim from packages/card-data/data/deck-catalog.json sfd-104-221):
 *   "[Temporary] (Kill this at the start of its controller's Beginning Phase,
 *    before scoring.)
 *    Friendly units have [Deflect]. (Opponents must pay :rb_rune_rainbow: to choose
 *    them with a spell or ability.)"
 *
 * Rules (CR v1.5):
 * - 816.1 / 816.1.a / 816.1.b: Temporary is a Triggered Ability keyword present on
 *   Permanents; it is functionally short for "At the start of this permanent's
 *   controller's Beginning Phase, before scoring, kill this." 816.1.c gives the
 *   trigger condition (the controller's Beginning Phase starting), and 816.2/816.2.a
 *   make multiple instances redundant.
 * - 809.1/809.1.b.3/809.1.c: Deflect is a Passive Ability keyword; omitted X is 1,
 *   and it adds a mandatory additional Power cost of any Domain to opponents'
 *   spells/abilities that choose the object.
 * - 364.1/364.2: "Friendly units have [Deflect]" is a continuous passive granting
 *   the keyword to units you control; ongoing grants are layer effects (contract 3.7).
 *
 * status: judge-required, no part approximated:
 * 1. the keyword registry has no Temporary KeywordDef (CR 816; ability-templates
 *    kw-temporary is unimplemented), and nothing registers the 816.1.b delayed kill
 *    at "beginning-start" — the card must not hand-write that keyword expansion
 *    (cards/README.md section 5).
 * 2. "Friendly units have [Deflect]" needs the continuous keyword-grant consumer:
 *    there is no continuous.grant-keyword instruction/effect producer from a
 *    CardProgram, and Deflect's own target.tax expansion has no layer/target reader
 *    (RIFT-90 target tax, RIFT-91 layers) — declaring only the keyword would make the
 *    grant an empty declaration.
 * The golden test still validates the identity/structure; no executable sub-body
 * exists, so the missing semantics are recorded as test.todo entries.
 */
export default {
  canonicalCardId: "card.hash-40f4f4fa670faf83d3f284bef5c9dc3ae0047668559d38ad02a7521cff81b378",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "(1) [Temporary] has no KeywordDef in the merged keyword registry (CR 816; ability-templates kw-temporary is unimplemented), " +
    "and no merged path registers the 816.1.b delayed kill at the controller's Beginning Phase start (816.1.c); the card must not " +
    "re-implement the keyword by hand (cards/README.md section 5). " +
    "(2) \"Friendly units have [Deflect]\" needs a continuous keyword-grant producer/consumer: no instruction registers " +
    "continuous.grant-keyword from a CardProgram, and the merged Deflect expansion (target.tax) has no layer/target-tax reader " +
    "(RIFT-90 target plan, RIFT-91 layers). \"if they didn't already\" is not printed here (it is a different card), so summing is 809.2's job once granting exists. " +
    "No approximate implementation is provided. The card has no locally executable instruction body; golden coverage is identity/structure plus test.todo.",
  abilities: [
    // 816.1: the printed [Temporary] declaration. Expansion/registration belongs
    // to effects/keywords/Temporary.ts and the timing pipeline, which are unmerged.
    { kind: "keyword", keyword: "temporary" },
    {
      // "Friendly units have [Deflect]" — an ongoing grant to your units.
      // Descriptive static shape (contract 3.7 continuous grant); no merged
      // consumer exists, so the grant is declared and not claimed executable.
      kind: "static",
      effect: {
        kind: "continuous.grant-keyword",
        keyword: "deflect",
        // 809.1.b.3: omitted X is 1.
        value: { kind: "constant", value: 1 },
        filter: {
          type: "unit",
          // "Friendly" on a static ability = the ability controller's permanents (740.1).
          controller: "controller",
          zone: "board"
        }
      }
    }
  ],
  sourceText:
    "[Temporary] (Kill this at the start of its controller's Beginning Phase, before scoring.)\n" +
    "Friendly units have [Deflect]. (Opponents must pay :rb_rune_rainbow: to choose them with a spell or ability.)"
} satisfies CardProgram;

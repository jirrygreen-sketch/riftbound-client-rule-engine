import type { CardProgram } from "../../ir/index.js";

/**
 * Seal of Unity (ogn-245-298) — OGN Gear, 0 energy / 1 Order power, no Might.
 *
 * Printed text:
 *   :rb_exhaust:: [Reaction] — [Add] :rb_rune_order:.
 *   (Abilities that add resources can't be reacted to.)
 *
 * Modelling notes (Core Rules v1.5): the same shape as the other Seals.
 * - "[E]: [Add]" is an Activated Ability (377.1); Gear may have Activated
 *   Abilities (151). The printed cost is the exhaust symbol, declared as an
 *   `exhaust` payment in the CostSpec (415.1; contract 3.1 / 3.6) and charged
 *   by the chain at Finalize (contract 3.5).
 * - "[Reaction]" is the Permissive keyword (813.1.a / 813.1.d on abilities),
 *   declared only and expanded by effects/keywords/Reaction.ts (contract 3.7).
 * - "[Add] :rb_rune_order:." is one Order Power into the Rune Pool (430.1,
 *   430.5: "[E]: Add [Y]" means Add 1 Power of the Order domain), submitted
 *   through the merged `effect.resources` primitive (RIFT-110). Add abilities
 *   finalize and resolve immediately and cannot be reacted to (430.2 / 430.4).
 *
 * Status: executable — cost declaration, keyword declaration and the single
 * resource-adding body all have merged implementations.
 */
const sealOfUnity = {
  canonicalCardId: "card.hash-23f35d50bcce67800843ffd66d90585cfde0e940ae8f6b728eff1b2dbc6ee8a7",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    { kind: "keyword", keyword: "reaction" },
    {
      kind: "activated",
      cost: {
        kind: "activated",
        payments: [{ kind: "exhaust" }]
      },
      timing: "reaction",
      body: [
        {
          id: "seal-of-unity.add-order",
          op: "effect.resources",
          args: {
            power: { kind: "constant", value: ["Order"] },
            linkKey: { kind: "constant", value: "added" }
          }
        }
      ]
    }
  ],
  sourceText:
    ":rb_exhaust:: [Reaction] — [Add] :rb_rune_order:. (Abilities that add resources can't be reacted to.)"
} satisfies CardProgram;

export default sealOfUnity;

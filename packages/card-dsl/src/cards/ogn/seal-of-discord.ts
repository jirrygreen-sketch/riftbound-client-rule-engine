import type { CardProgram } from "../../ir/index.js";

/**
 * Seal of Discord (ogn-204-298) — OGN Gear, 0 energy / 1 Chaos power, no Might.
 *
 * Printed text:
 *   :rb_exhaust:: [Reaction] — [Add] :rb_rune_chaos:.
 *   (Abilities that add resources can't be reacted to.)
 *
 * Modelling notes (Core Rules v1.5):
 * - ":rb_exhaust:: … : [Add] …" is an Activated Ability (377.1 / 377.3: the colon
 *   separates cost from effect). Gear may have Activated Abilities (151).
 * - The printed cost is the exhaust symbol (415.1: exhausting a Ready object;
 *   the exhaust-symbol cost form is declared as an `exhaust` payment, contract
 *   3.1 CostSpec / 3.6 cost.pay). Payment is checked at Finalize by the chain
 *   (contract 3.5); this card only declares the CostSpec, never a payment flow.
 * - "[Reaction]" is a Permissive keyword on the ability (813.1.a / 813.1.d:
 *   on abilities it is written "[Reaction][>]"); it grants the ability the
 *   Closed State window plus all Action timing (813.1.b-c). Keywords are
 *   declared only, never re-implemented in the card (contract 3.7 / README 5).
 * - "[Add] :rb_rune_chaos:." is the Add action (430.1, 430.5: "[E]: Add [Y]"
 *   means Add 1 Power of the Order domain): one Chaos Power into the Rune Pool,
 *   submitted through the merged `effect.resources` primitive (adds Energy, then
 *   Power). Add abilities finalize and resolve immediately (430.2) and are
 *   Limited Actions (430.4); that timing belongs to the chain / Add path, not
 *   to this data.
 * - The parenthetical "Abilities that add resources can't be reacted to." is
 *   reminder text for 430.2 (no new instruction).
 *
 * Status: executable — the activated ability's cost declaration, the reaction
 * keyword and the single `effect.resources` body all have merged, executable
 * implementations (cost/cost-plan.ts + cost/payment.ts for the exhaust
 * payment; effects/keywords/Reaction.ts for the keyword; effects/instructions/
 * effect.resources.ts for the Power).
 */
const sealOfDiscord = {
  canonicalCardId: "card.hash-00db977a8e2688acd3c32aa05d515415a821d541bbe0196f8247bb9e69b4433f",
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
          id: "seal-of-discord.add-chaos",
          op: "effect.resources",
          args: {
            power: { kind: "constant", value: ["Chaos"] },
            linkKey: { kind: "constant", value: "added" }
          }
        }
      ]
    }
  ],
  sourceText:
    ":rb_exhaust:: [Reaction] — [Add] :rb_rune_chaos:. (Abilities that add resources can't be reacted to.)"
} satisfies CardProgram;

export default sealOfDiscord;

import type { CardProgram } from "../../ir/index.js";

/**
 * Boots of Swiftness (sfd-133-221) — Gear, 3 Energy, no printed Power,
 * Might 2, Chaos, tag Equipment.
 *
 * sourceText (verbatim from packages/card-data/data/deck-catalog.json sfd-133-221):
 *   "[Equip] :rb_rune_chaos: (:rb_rune_chaos:: Attach this to a unit you control.)"
 *
 * Rules (CR v1.5):
 * - 818.1 / 818.1.a: Equip is an Activated Ability keyword present on Equipment Gear.
 * - 818.1.c / 818.1.c.2: formatted "Equip [Cost]" and functionally short for
 *   "[Cost]: Attach this gear to a unit you control."
 * - 135.2.e.4: the printed :rb_rune_chaos: is one Chaos Power cost; the Equip cost
 *   has no Energy (the card-level 3 Energy is the play cost, not the Equip cost).
 *
 * status: judge-required. The card only declares the keyword (cards/README.md
 * section 5); execution depends on two unmerged pieces:
 * 1. contract 3.5 wiring from a CardProgram keyword ability into
 *    effects/keywords/Equip.ts is missing, and the printed Equip cost cannot reach
 *    KeywordDef.expand because the merged signature carries only value/host
 *    (contract 3.8.3 params.cost is not implemented).
 * 2. the merged Equip expansion declares cost.payments [{ kind: "equip" }], which
 *    cost/plan-values.ts readCost blocks with CostPlanError reason "judge-required"
 *    ("Unsupported payment kind: equip", RIFT-89 cost-payment batch).
 * The merged effect.attach half is exercised by the golden test; that partial
 * evidence does not make the activation executable.
 */
const equip = {
  // Printed "Equip [Chaos]": one resource symbol, the Chaos Power rune. value
  // counts the printed resource symbols and costDomain records the Power rune.
  kind: "keyword",
  keyword: "equip",
  value: 1,
  costDomain: "Chaos"
} as const;

export default {
  canonicalCardId: "card.hash-a22e6e418137f242aaa2ac6403b7a752bfc243cecc9d372bc3dfc04dabced9e0",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "[Equip] cannot execute yet: (1) the card-program -> keyword-expansion -> chain wiring (contract 3.5) is unmerged, and the printed " +
    "Equip cost (1 Chaos Power, CR 818.1.c) cannot reach KeywordDef.expand because the merged signature only carries value/host " +
    "(contract 3.8.3 params.cost is not implemented); (2) the merged effects/keywords/Equip.ts expansion declares cost.payments " +
    "[{ kind: \"equip\" }], which cost/plan-values.ts readCost rejects with CostPlanError reason \"judge-required\" " +
    "(\"Unsupported payment kind: equip\", RIFT-89 cost-payment batch). The merged effect.attach body is exercised by the golden test; " +
    "the activation cost cannot be paid, so the card is not executable. 818.1.c.3/.c.4 (non-resource and cost-altering Equip text) do not apply here.",
  abilities: [equip],
  sourceText:
    "[Equip] :rb_rune_chaos: (:rb_rune_chaos:: Attach this to a unit you control.)"
} satisfies CardProgram;

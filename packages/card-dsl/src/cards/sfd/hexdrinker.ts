import type { CardProgram } from "../../ir/index.js";

/**
 * Hexdrinker (sfd-102-221) — Gear, 2 Energy, no printed Power, Might 1, Body,
 * tag Equipment.
 *
 * sourceText (verbatim from packages/card-data/data/deck-catalog.json sfd-102-221):
 *   "[Equip] :rb_rune_body: (:rb_rune_body:: Attach this to a unit you control.)"
 *
 * Rules (CR v1.5):
 * - 818.1 / 818.1.a: Equip is an Activated Ability keyword present on Equipment Gear.
 * - 818.1.c / 818.1.c.2: formatted "Equip [Cost]" and functionally short for
 *   "[Cost]: Attach this gear to a unit you control."
 * - 135.2.e.4: the printed :rb_rune_body: is one Body Power cost; the Equip cost has
 *   no Energy (the card-level 2 Energy is the play cost, not the Equip cost).
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
  // Printed "Equip [Body]": one resource symbol, the Body Power rune. value
  // counts the printed resource symbols and costDomain records the Power rune.
  kind: "keyword",
  keyword: "equip",
  value: 1,
  costDomain: "Body"
} as const;

export default {
  canonicalCardId: "card.hash-655981631747696ba307a61ac6067d55653bb1215a56106697946c14c7da3146",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "[Equip] cannot execute yet: (1) the card-program -> keyword-expansion -> chain wiring (contract 3.5) is unmerged, and the printed " +
    "Equip cost (1 Body Power, CR 818.1.c) cannot reach KeywordDef.expand because the merged signature only carries value/host " +
    "(contract 3.8.3 params.cost is not implemented); (2) the merged effects/keywords/Equip.ts expansion declares cost.payments " +
    "[{ kind: \"equip\" }], which cost/plan-values.ts readCost rejects with CostPlanError reason \"judge-required\" " +
    "(\"Unsupported payment kind: equip\", RIFT-89 cost-payment batch). The merged effect.attach body is exercised by the golden test; " +
    "the activation cost cannot be paid, so the card is not executable. 818.1.c.3/.c.4 (non-resource and cost-altering Equip text) do not apply here.",
  abilities: [equip],
  sourceText:
    "[Equip] :rb_rune_body: (:rb_rune_body:: Attach this to a unit you control.)"
} satisfies CardProgram;

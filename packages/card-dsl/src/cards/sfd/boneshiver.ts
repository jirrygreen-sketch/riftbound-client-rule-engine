import type { CardProgram } from "../../ir/index.js";

/**
 * Boneshiver (sfd-118-221) — Gear, 3 Energy, no printed Power, Might 2, Body,
 * tag Equipment.
 *
 * sourceText (verbatim from packages/card-data/data/deck-catalog.json sfd-118-221):
 *   "[Equip] :rb_energy_1::rb_rune_body: (:rb_energy_1::rb_rune_body:: Attach this
 *    to a unit you control.)"
 *
 * Rules (CR v1.5):
 * - 818.1 / 818.1.a: Equip is an Activated Ability keyword present on Equipment Gear.
 * - 818.1.c / 818.1.c.2: formatted "Equip [Cost]" and functionally short for
 *   "[Cost]: Attach this gear to a unit you control."
 * - 135.2.e.4: the printed Equip cost is one Energy plus one Body Power (two resource
 *   symbols); the card-level 3 Energy is the play cost, not the Equip cost.
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
  // Printed "Equip [1][Body]": two resource symbols (1 Energy + 1 Body Power).
  // value counts the printed resource symbols and costDomain records the Power rune.
  kind: "keyword",
  keyword: "equip",
  value: 2,
  costDomain: "Body"
} as const;

export default {
  canonicalCardId: "card.hash-fafaf203c1a2733970ae4f8f4051d2c1b16da75c5e2e637905f8fce0d6287a75",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "[Equip] cannot execute yet: (1) the card-program -> keyword-expansion -> chain wiring (contract 3.5) is unmerged, and the printed " +
    "Equip cost (1 Energy + 1 Body Power, CR 818.1.c/135.2.e.4) cannot reach KeywordDef.expand because the merged signature only carries " +
    "value/host (contract 3.8.3 params.cost is not implemented); (2) the merged effects/keywords/Equip.ts expansion declares cost.payments " +
    "[{ kind: \"equip\" }], which cost/plan-values.ts readCost rejects with CostPlanError reason \"judge-required\" " +
    "(\"Unsupported payment kind: equip\", RIFT-89 cost-payment batch). The merged effect.attach body is exercised by the golden test; " +
    "the activation cost cannot be paid, so the card is not executable. 818.1.c.3/.c.4 (non-resource and cost-altering Equip text) do not apply here.",
  abilities: [equip],
  sourceText:
    "[Equip] :rb_energy_1::rb_rune_body: (:rb_energy_1::rb_rune_body:: Attach this to a unit you control.)"
} satisfies CardProgram;

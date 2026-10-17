import type { CardProgram } from "../../ir/index.js";

/**
 * Doran's Ring (sfd-124-221) — Gear, 1 Energy, no printed Power, Might 1,
 * Chaos, tag Equipment.
 *
 * sourceText (verbatim from packages/card-data/data/deck-catalog.json sfd-124-221):
 *   "[Equip] :rb_rune_chaos: (:rb_rune_chaos:: Attach this to a unit you control.)"
 *
 * Rules (CR v1.5):
 * - 818.1 / 818.1.a: Equip is an Activated Ability keyword present on Equipment Gear.
 * - 818.1.c / 818.1.c.2: formatted "Equip [Cost]" and functionally short for
 *   "[Cost]: Attach this gear to a unit you control."
 * - 135.2.e.4: the printed :rb_rune_chaos: is one Chaos Power cost; the Equip cost
 *   has no Energy (the card-level 1 Energy is the play cost, not the Equip cost).
 *
 * status: judge-required. The card only declares the keyword (cards/README.md
 * section 5); execution depends on two unmerged pieces:
 * 1. contract 3.5 wiring from a CardProgram keyword ability into
 *    effects/keywords/Equip.ts is missing (RIFT-257 card-program binding), and the
 *    printed Equip cost cannot reach KeywordDef.expand because the merged Equip
 *    expansion reads only value/host even though the interface now declares
 *    params (contract 3.8.3 spelling).
 * 2. the merged Equip expansion declares cost.payments [{ kind: "equip" }], which
 *    cost/plan-values.ts readCost does not support (there is no Equip payment kind;
 *    the cost.* instruction batch is RIFT-261, unmerged HEAD).
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
  canonicalCardId: "card.hash-7cdb3acf3498b65e29a03912deb195f448b78a9da466c922703fc4edda7a0512",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "[Equip] cannot execute yet: (1) the card-program -> keyword-expansion -> chain wiring (contract 3.5) is unmerged (card-program binding RIFT-257), and the printed " +
    "Equip cost (1 Chaos Power, CR 818.1.c) cannot reach KeywordDef.expand because the merged Equip expansion reads only value/host " +
    "even though the interface declares the contract 3.8.3 params spelling; (2) the merged effects/keywords/Equip.ts expansion declares cost.payments " +
    "[{ kind: \"equip\" }], and cost/plan-values.ts readCost has no Equip payment kind (the cost.* instruction batch is RIFT-261). " +
    "The merged effect.attach body is exercised by the golden test; " +
    "the activation cost cannot be paid, so the card is not executable. 818.1.c.3/.c.4 (non-resource and cost-altering Equip text) do not apply here.",
  abilities: [equip],
  sourceText:
    "[Equip] :rb_rune_chaos: (:rb_rune_chaos:: Attach this to a unit you control.)"
} satisfies CardProgram;

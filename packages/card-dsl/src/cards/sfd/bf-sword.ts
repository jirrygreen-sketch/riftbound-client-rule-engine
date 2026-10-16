
/**
 * B.F. Sword (sfd-161-221) — Fiora SFD Gear.
 *
 * Printed text: "[Equip] :rb_rune_order: (:rb_rune_order:: Attach this to a
 * unit you control.)"
 *
 * Single valued "Equip" keyword ability (CR 818) whose printed cost is one
 * Order power, recorded through the costDomain extension field. Expansion of
 * the Equip activated ability (cost payment at Finalize, controlled-unit
 * target, effect.attach body) belongs to the engine keyword registry
 * (contract 3.7), which is not merged yet.
 */
export default {
  canonicalCardId: "card.hash-959c19d68f06f8f929625bfde93a1132701da5a5d0b49e91583db341384f0bfe",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    { kind: "keyword", keyword: "equip", value: 1, costDomain: "Order" }
  ],
  sourceText:
    "[Equip] :rb_rune_order: (:rb_rune_order:: Attach this to a unit you control.)"
} as const;


/**
 * Sacred Shears (sfd-172-221) — Fiora SFD Gear.
 *
 * Printed text: "[Equip] :rb_rune_order: (:rb_rune_order:: Attach this to a
 * unit you control.)"
 *
 * Single valued "Equip" keyword ability (CR 818) whose printed cost is one
 * Order power, recorded through the costDomain extension field. Expansion of
 * the Equip activated ability belongs to the engine keyword registry
 * (contract 3.7), which is not merged yet.
 */
export default {
  canonicalCardId: "card.hash-d3579e6825470471f5ce05c53533806a5244c5e84364fe57b2aab0b7cc0f14e0",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    { kind: "keyword", keyword: "equip", value: 1, costDomain: "Order" }
  ],
  sourceText:
    "[Equip] :rb_rune_order: (:rb_rune_order:: Attach this to a unit you control.)"
} as const;

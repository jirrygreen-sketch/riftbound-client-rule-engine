
/**
 * Warmog's Armor (sfd-108-221) — Fiora SFD Gear.
 *
 * Printed text: "[Equip] :rb_rune_body: (:rb_rune_body:: Attach this to a
 * unit you control.)"
 *
 * Single valued "Equip" keyword ability (CR 818) whose printed cost is one
 * Body power, recorded through the costDomain extension field. Expansion of
 * the Equip activated ability belongs to the engine keyword registry
 * (contract 3.7), which is not merged yet.
 */
export default {
  canonicalCardId: "card.hash-902c6a1366a1a0e653ccb65102ff621b109af3b0b40f5bbeb7d8d3a5aeae2322",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    { kind: "keyword", keyword: "equip", value: 1, costDomain: "Body" }
  ],
  sourceText:
    "[Equip] :rb_rune_body: (:rb_rune_body:: Attach this to a unit you control.)"
} as const;

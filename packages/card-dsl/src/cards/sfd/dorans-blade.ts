
/**
 * Doran's Blade (sfd-095-221) — Fiora SFD Gear.
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
  canonicalCardId: "card.hash-a1ee07f71d453092ab7d54f9491684e972b735b22bb1f3fda73f2641bcedbfe1",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    { kind: "keyword", keyword: "equip", value: 1, costDomain: "Body" }
  ],
  sourceText:
    "[Equip] :rb_rune_body: (:rb_rune_body:: Attach this to a unit you control.)"
} as const;

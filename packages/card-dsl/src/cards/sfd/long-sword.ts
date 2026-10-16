
/**
 * Long Sword (sfd-022-221) — Rumble SFD Gear.
 *
 * Printed text: "[Quick-Draw] (This has [Reaction]. When you play it, attach
 * it to a unit you control.) / [Equip] :rb_rune_fury: (:rb_rune_fury::
 * Attach this to a unit you control.)"
 *
 * Both abilities are keyword references (contract 3.1 / 3.7): the Gear hosts
 * "Quick-Draw" (CR 819) and a valued "Equip" (CR 818) whose printed cost is
 * one Fury power, recorded through the costDomain extension field. Keyword
 * expansion — Equip's activation cost and controlled-unit targeting,
 * Quick-Draw's Reaction timing and play-triggered attach — belongs to the
 * engine keyword registry (effects/keywords/<keyword>.ts), which is not
 * merged yet; the card layer only declares keyword identity and value.
 */
export default {
  canonicalCardId: "card.hash-cab923a670e4baa826aa3de381c8b992bf33987fcb0d65feb75ca538a8681010",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    { kind: "keyword", keyword: "quick-draw" },
    { kind: "keyword", keyword: "equip", value: 1, costDomain: "Fury" }
  ],
  sourceText:
    "[Quick-Draw] (This has [Reaction]. When you play it, attach it to a unit you control.)\n[Equip] :rb_rune_fury: (:rb_rune_fury:: Attach this to a unit you control.)"
} as const;

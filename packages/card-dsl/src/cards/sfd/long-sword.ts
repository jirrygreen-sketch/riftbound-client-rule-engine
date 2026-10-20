
/**
 * Long Sword (sfd-022-221) — Rumble SFD Gear (Equipment, printed Might
 * Bonus +2, play cost 2 Energy + 1 Fury Power).
 *
 * Printed text: "[Quick-Draw] (This has [Reaction]. When you play it, attach
 * it to a unit you control.) / [Equip] :rb_rune_fury: (:rb_rune_fury::
 * Attach this to a unit you control.)"
 *
 * Both abilities are keyword references (contract 3.1 / 3.7). Quick-Draw
 * (CR 819) expands to a Reaction timing grant for this Gear plus a mandatory
 * card-played trigger that attaches it to a Unit you control. Equip (CR 818)
 * expands to an action-speed activated attach; its printed cost is one Fury
 * Power and no Energy, passed to the expansion through params.cost (contract
 * 3.8.3). `value` / `costDomain` remain the descriptive record of the symbol.
 *
 * Execution evidence (test/cards/sfd/long-sword.test.mjs, real ProgramBinding /
 * ChainEngine path): a Main-Phase play pays 2 Energy + 1 Fury and Quick-Draw
 * attaches it to the only friendly Unit (CR 819.1.d); with Priority in a
 * Closed Chain on the opponent's turn it is played at Reaction speed
 * (CR 819.1.b/819.1.c, consumed since RIFT-884); the attached Unit gains the
 * +2 Might Bonus (CR 137.3, RIFT-883); Equip pays exactly one Fury Power and
 * is rejected atomically without one.
 */
export default {
  canonicalCardId: "card.hash-cab923a670e4baa826aa3de381c8b992bf33987fcb0d65feb75ca538a8681010",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    { kind: "keyword", keyword: "quick-draw" },
    {
      kind: "keyword",
      keyword: "equip",
      value: 1,
      costDomain: "Fury",
      params: {
        cost: {
          kind: "activated",
          payments: [{ kind: "power", amount: { kind: "constant", value: 1 }, allowedDomains: ["Fury"] }]
        }
      }
    }
  ],
  sourceText:
    "[Quick-Draw] (This has [Reaction]. When you play it, attach it to a unit you control.)\n[Equip] :rb_rune_fury: (:rb_rune_fury:: Attach this to a unit you control.)"
} as const;


/**
 * Doran's Blade (sfd-095-221) — Fiora SFD Gear (Equipment, printed Might Bonus +2).
 *
 * Printed text: "[Equip] :rb_rune_body: (:rb_rune_body:: Attach this to a
 * unit you control.)"
 *
 * A single "Equip" keyword (CR 818). The engine keyword registry expands it
 * into an action-speed activated ability whose body attaches this Equipment
 * to a Unit you control (818.1.b, 818.1.c.2, 818.2). The printed Equip cost
 * is one Body Power and no Energy. It reaches the expansion through
 * params.cost (contract 3.8.3) as an activated cost with a single Power
 * payment restricted to Body, so Finalize pays exactly that rune; `value`
 * and `costDomain` remain the descriptive record of the printed symbol.
 *
 * The Might Bonus (CR 137.3, 435.1.d) is a printed characteristic applied by
 * the rules engine while this is attached; it is not part of this ability
 * program and is tracked by RIFT-883.
 *
 * Production evidence (README 4.1):
 * test/cards/templates/keyword-equip-printed-power-882.test.mjs
 */
export default {
  canonicalCardId: "card.hash-a1ee07f71d453092ab7d54f9491684e972b735b22bb1f3fda73f2641bcedbfe1",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    {
      kind: "keyword",
      keyword: "equip",
      value: 1,
      costDomain: "Body",
      params: {
        cost: {
          kind: "activated",
          payments: [{ kind: "power", amount: { kind: "constant", value: 1 }, allowedDomains: ["Body"] }]
        }
      }
    }
  ],
  sourceText:
    "[Equip] :rb_rune_body: (:rb_rune_body:: Attach this to a unit you control.)"
} as const;

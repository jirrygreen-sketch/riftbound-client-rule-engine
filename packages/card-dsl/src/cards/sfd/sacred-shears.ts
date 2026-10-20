
/**
 * Sacred Shears (sfd-172-221) — Fiora SFD Gear (Equipment, printed Might Bonus +1).
 *
 * Printed text: "[Equip] :rb_rune_order: (:rb_rune_order:: Attach this to a
 * unit you control.)"
 *
 * A single "Equip" keyword (CR 818). The engine keyword registry expands it
 * into an action-speed activated ability whose body attaches this Equipment
 * to a Unit you control (818.1.b, 818.1.c.2, 818.2). The printed Equip cost
 * is one Order Power and no Energy. It reaches the expansion through
 * params.cost (contract 3.8.3) as an activated cost with a single Power
 * payment restricted to Order, so Finalize pays exactly that rune; `value`
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
  canonicalCardId: "card.hash-d3579e6825470471f5ce05c53533806a5244c5e84364fe57b2aab0b7cc0f14e0",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    {
      kind: "keyword",
      keyword: "equip",
      value: 1,
      costDomain: "Order",
      params: {
        cost: {
          kind: "activated",
          payments: [{ kind: "power", amount: { kind: "constant", value: 1 }, allowedDomains: ["Order"] }]
        }
      }
    }
  ],
  sourceText:
    "[Equip] :rb_rune_order: (:rb_rune_order:: Attach this to a unit you control.)"
} as const;

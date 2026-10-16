import type { CardProgram } from "../../ir/index.js";

/**
 * Bandle Tree (ogn-278-298) — Battlefield, domainless.
 *
 * "You may hide an additional card here."
 *
 * CR v1.5 anchors:
 * - 107.3.a / 107.3.b: each Battlefield has a Facedown Zone with a maximum
 *   occupancy of one card; 107.3.b.1 states the maximum occupancy can increase
 *   or decrease, and 107.3.b.2 defines the over-capacity case. This card is a
 *   permission that raises that maximum by one for its own battlefield.
 * - 422.1 / 422.2: Hiding is a Discretionary Action that places a card
 *   facedown at a Battlefield you control; 422.2.a ties the permission to the
 *   Hidden keyword, and 811.1.b is Hidden's functional short form (hide for
 *   [A], play later for [0]) — this card grants no discount and does not make
 *   cards without Hidden hideable (confirmed by the RIFT-40 triage: "与
 *   cost.hidden 的槽位检查可表达常规一张加一张；不授予免付费、立即使用或
 *   跨战场隐藏许可").
 * - 190.6.a / 190.6.d: "you" is this battlefield's Controller; with no
 *   controller the ability grants nobody an extra slot (190.6.b).
 * - The "may" is a permission, not a chain instruction: the card does not make
 *   anybody hide a card, so it is a static ability rather than a triggered or
 *   activated one (contract §3.1).
 *
 * Status rationale (contract §3.1, cards README §2): the needed shape is a
 * continuous restriction on the facedown-zone occupancy limit
 * (cost.hidden / continuous.restrict in the primitive inventory). Neither is
 * merged: there is no instruction file for either op, no layer evaluator that
 * consumes a continuous.restrict entry, and the hidden-cost path itself
 * (cost.hidden, RIFT-89 scope) has no instruction. The ability is therefore
 * judge-required and is written with the static-effect shape the contract
 * reserves for it, so a later consumer can pick it up without re-deriving the
 * rules.
 */
export default {
  canonicalCardId: "card.hash-5440d378426747276f389ce3e9731d1378a3a303a7309d785ef183114d2c326c",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "Raising the Facedown Zone occupancy limit (CR 107.3.b.1) needs continuous.restrict, and the generic Hide path needs cost.hidden: neither op has a merged instruction file (both are in the RIFT-9 primitive inventory) and no merged layer or cost consumer reads them, so the extra-slot permission cannot execute. The ability grants no discount and does not make cards without Hidden hideable. Dependencies: the cost.hidden/Hide workstream (RIFT-89 batch3-cost-plan scope) and the continuous-effect consumer for restrict.",
  sourceText: "You may hide an additional card here.",
  abilities: [
    {
      kind: "static",
      effect: {
        kind: "continuous.restrict",
        // "an additional card here": +1 to this battlefield's Facedown Zone
        // occupancy maximum (107.3.b / 107.3.b.1), for that zone only.
        restriction: "facedown-zone-maximum-occupancy",
        amount: 1,
        location: "self"
      }
    }
  ]
} satisfies CardProgram;

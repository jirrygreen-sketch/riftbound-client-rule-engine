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
 * Status rationale (contract §3.1, cards README §2): the raised occupancy
 * limit is a continuous restriction. The merged continuous.restrict
 * primitive registers a numeric cap (mode "limit") and the ability-layer
 * binder can register this declaration, but neither the binder's raw
 * restriction shape nor a consumer turns the registered amount into the
 * per-battlefield Facedown Zone occupancy limit that a Hide action reads.
 * The card stays judge-required because the Hide/facedown path has no consumer for the
 * raised Facedown Zone maximum: cost.hidden and the occupancy check are not
 * connected to a playable Hide action, so "an additional card here" cannot be
 * enforced even after the restriction is registered.
 * The ability keeps the static-effect shape the contract reserves for it, so
 * a later consumer can pick it up without re-deriving the rules.
 */
export default {
  canonicalCardId: "card.hash-5440d378426747276f389ce3e9731d1378a3a303a7309d785ef183114d2c326c",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "Missing the battlefield-scoped Facedown Zone capacity consumer for continuous.restrict (CR 107.3.b.1): " +
    "the static binder records amount 1, but no Hide action reads it as an increase to this battlefield's normal one-card cap. " +
    "cost.hidden already plans [A], but the effects test-kernel pay action does not debit Power; its receipt is not proof of payment. " +
    "The cost wrapper does not bind Hidden eligibility, facedown movement, occupancy/control checks " +
    "or next-turn play permission to an action (107.3.c/d, 422.2.a, 811.1.b). The extra slot must remain local, preserve " +
    "the normal cost, and follow the battlefield's current controller.",
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

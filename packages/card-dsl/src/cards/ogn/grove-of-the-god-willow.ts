import type { CardProgram } from "../../ir/index.js";

/**
 * Grove of the God-Willow (ogn-280-298) — Battlefield, domainless.
 *
 * "When you hold here, draw 1."
 *
 * CR v1.5 anchors:
 * - 383.4.d / 383.4.d.1 / 383.4.d.2.b: "When you hold here …" is a Hold
 *   Effect; it is put on the chain when the controller of the triggering
 *   source has performed a Hold (timing point "hold", emitted by scoring/,
 *   rule refs 315.2.b.2 / 471.2 / 473.2.b). The held battlefield is the ability
 *   host ("here") and the holding player is its controller (190.6.a/190.6.d).
 * - 414.3: "Draw X." draws X cards; 414.1 / 414.1.a: the implicit drawer is
 *   the effect's controller and the implicit source is the top of that
 *   player's Main Deck. `effect.draw` submits the closed "draw" GameAction and
 *   the engine owns deck order and the Burn Out continuation (414.4/432).
 * - 383.4.d.2.c: the trigger still happens if the point from Holding is
 *   negated or replaced, which is why the draw is an unlinked, unconditional
 *   instruction in the ability body.
 *
 * Status rationale (contract §3.1, cards README §2): every part of this card
 * has merged, executable support — the "hold" timing point is in the closed
 * enum and emitted by the scoring flow, the ability shape is an ordinary
 * triggered ability, and the whole effect is one `effect.draw` instruction
 * with a printed constant. The golden test executes that instruction through
 * the real interpreter and reference kernel and asserts the printed amount
 * and the implicit drawer; the trigger-to-chain pipeline itself is the same
 * engine-level dependency the other merged triggered cards record in
 * `test.todo` and is not a card-specific gap.
 *
 * Scope note: this is the same class of card as the merged sfd/bubble-bot and
 * ogn/pit-rookie programs (one trigger whose whole body is a merged primitive),
 * and it is marked `executable` on that precedent. The trigger subscription /
 * chain path is engine work tracked by RIFT-33/RIFT-26 and is recorded as
 * `test.todo` in the golden test; the card itself has no unresolved rule,
 * keyword, layer or primitive.
 */
export default {
  canonicalCardId: "card.hash-d1f5f5fd364619f443c985e7fbad178f65d050634effd13cb00fa940a37d3b0a",
  rulesetVersion: "core-1.5",
  status: "executable",
  sourceText: "When you hold here, draw 1.",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "hold",
        // "you hold here": the hold happens at this battlefield and is
        // performed by its controller (190.6.d).
        filter: { event: "hold", here: true, player: "controller" }
      },
      optional: false,
      body: [
        {
          // "draw 1": the drawer defaults to the ability controller
          // (414.1/414.1.a, 190.6.d); no target or pick is involved.
          id: "grove-of-the-god-willow.draw",
          op: "effect.draw",
          args: { amount: { kind: "constant", value: 1 } }
        }
      ]
    }
  ]
} satisfies CardProgram;

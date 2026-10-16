import type { CardProgram } from "../../ir/index.js";

/**
 * Altar to Unity (ogn-275-298) — Battlefield, domainless.
 *
 * "When you hold here, play a 1 :rb_might: Recruit unit token in your base."
 *
 * CR v1.5 anchors:
 * - 383.4.d / 383.4.d.1 / 383.4.d.2.b: "When you hold here …" is a Hold
 *   Effect; the Hold Abilities of anything that references the player Holding
 *   are put on the chain when the Condition that the controller of the
 *   triggering source has performed a Hold is met (timing point "hold",
 *   emitted by scoring/ with rule refs 315.2.b.2 / 471.2 / 473.2.b).
 * - 190.6.a / 190.6.d: "you" in a battlefield's ability is the battlefield's
 *   Controller, and the implied controller makes the ability's choices.
 * - 440.2.c / 185.2.a: the printed wording "play a … token" creates the token
 *   on the Chain and lets the play action take it over, which is
 *   `effect.token` mode "play" (the merged primitive performs create-token
 *   with to "chain" and then hands the returned ObjectRef to play).
 * - 187.1: a 1 [M] Recruit token is a domainless unit token with 1 Might and
 *   the Recruit tag; 185.3.a / 185.3.b: tokens have no costs and no domains
 *   (null characteristics, never 0).
 *
 * Status rationale (contract §3.1, cards README §2): the trigger and the token
 * definition are expressible and the merged `effect.token` implements the
 * chain-create + play handoff, but the printed destination "in your base"
 * cannot be named by the frozen IR. `location` must evaluate to literal data
 * ({type:"base", player:<PlayerId>}) and the primitive only accepts a base
 * whose player is `ctx.controller`; no Expr or ObjectSelector can build a
 * LocationRef from the ability controller (effect.move accepts the literal
 * "controller-base", effect.token has no such spelling). Hard-coding a seat
 * would place the token in the wrong player's base, so the card stays
 * judge-required with the intended shape preserved.
 *
 * `player: "controller"` below is the spelling merged cards use for "the
 * ability controller's base" (sfd/assembly-rig, sfd/rumble-scrapper). It is
 * deliberately not resolvable today; the golden test asserts that the merged
 * primitive negates this placeholder instead of silently creating a token.
 */
export default {
  canonicalCardId: "card.hash-235642b62ac009ff34cfa13db7debd2bf1e71c1a9bf411cf5ffab5dfd06e5099",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "The printed destination 'in your base' cannot be named: effect.token evaluates `location` as literal data and accepts only {type:'base', player:<PlayerId>} whose player equals ctx.controller, while the frozen IR has no controller-relative LocationRef expression or spelling (effect.move resolves the literal 'controller-base', effect.token does not). Hard-coding a seat would create the token in the wrong base, which is not approximated here. The hold trigger, the CR 187.1 Recruit definition and the 440.2.c chain-create + play handoff are already merged; the card depends on an effect.token follow-up / contract change request for a controller-relative location (also see the trigger pipeline dependency RIFT-33 scenarios-triggers).",
  sourceText: "When you hold here, play a 1 :rb_might: Recruit unit token in your base.",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "hold",
        // "here" = this battlefield (the ability host); "you" = its controller
        // (190.6.d). Spelling follows the merged battlefield cards that use
        // "When you hold here" (sfd/rumble-scrapper, sfd/sunken-temple).
        filter: { event: "hold", here: true, player: "controller" }
      },
      optional: false,
      body: [
        {
          id: "altar-to-unity.play-recruit",
          op: "effect.token",
          args: {
            token: { kind: "constant", value: "recruit" },
            amount: { kind: "constant", value: 1 },
            mode: { kind: "constant", value: "play" },
            location: { kind: "constant", value: { type: "base", player: "controller" } },
            linkKey: { kind: "constant", value: "recruitToken" }
          }
        }
      ]
    }
  ]
} satisfies CardProgram;

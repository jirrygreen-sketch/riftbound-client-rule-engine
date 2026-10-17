import type { CardProgram } from "../../ir/index.js";

/**
 * Seat of Power (sfd-217-221) — Battlefield, Colorless.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, sfd-217-221, verbatim
 * including the extra terminating period recorded in
 * docs/plans/survey/data-issues-recheck.md):
 *   "When you conquer here, draw 1 for each other battlefield you or allies
 *    control.."
 *
 * CR v1.5 anchors:
 * - 383.4.c / 383.4.c.1 / 383.4.c.2.b / 383.4.c.2.c: "When you conquer here"
 *   is a Conquer Effect — a Triggered Ability that references the player
 *   Conquering; the closed conquer timing point (468.5.d / 471.1 / 473.2.a)
 *   is the subscription point, and it triggers even if the point gain is
 *   negated or replaced.
 * - 471.1.a: "In Modes of Play with teammates, Battlefields under the Control
 *   of a teammate during the scoring step ... are also disqualified from being
 *   Scored through Conquer" — that rule is what "you or allies control" ties
 *   to. The teammate relation is part of the Mode of Play, not of a single
 *   card.
 * - 414.1 / 414.3: "draw 1 for each …" is a Draw whose amount is evaluated at
 *   resolution (contract 3.6 evaluate timing); a short deck burns out through
 *   the kernel (414.4 / 432.x).
 * - 470.1 / 470.3: finishing the Conquer is the Scoring process; this ability
 *   itself only draws, it does not gain points.
 *
 * Status: judge-required. The conquer timing point itself is no longer the gap:
 * turn/flow.ts's Score wave now emits `conquer` (recorded by the RIFT-270
 * timing-point producer audit in docs/rules/timing-point-producers.md), so the older
 * "no merged module emits conquer" note is stale. The remaining gaps are:
 * 1. the battlefield-relative "here" restriction has no EventPattern vocabulary:
 *    the card keeps the 053.3 `here: true` placeholder, which the events/trigger-spec
 *    validator rejects (unknown field) and programs/filters.ts translateTriggerFilter
 *    rejects as well ("Unsupported filter field here"), so the ability cannot
 *    register through the merged CardProgram trigger adapter (RIFT-257).
 * 2. the count still needs the Mode-of-Play teammate relation (471.1.a,
 *    315.2.b.3): no merged ObjectFilter / PlayerSelector / Expr expands
 *    `controller: "you-or-ally"` to the controller and their allies. The count's
 *    actual evaluateExpression -> queryObjects path already queries Battlefield
 *    snapshots and handles `exclude: "self"` itself; translateObjectFilter is
 *    not part of this path. Binding only controller to "A" correctly counts
 *    other A-controlled Battlefields and excludes this Battlefield.
 * The trigger + count + draw shape is recorded below so the missing pieces stay
 * auditable; the golden executes the count and draw with controller bound to
 * "A", including zero/one/multiple other Battlefields. This does not supply
 * ally semantics. The extra-period data issue is reported, not fixed.
 */
export default {
  canonicalCardId: "card.hash-8ad41dd9ba742358d12656164c456e4f9cc43b4712fcb9c9f120661d5c208fac",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "The conquer timing point is merged (turn/flow.ts emits it in the Score wave; the RIFT-270 producer audit records " +
    "this in docs/rules/timing-point-producers.md), but the printed ability " +
    "(383.4.c / 473.2.a) still cannot run end to end, and nothing is approximated: (1) the battlefield-relative \"here\" " +
    "restriction has no EventPattern vocabulary — the 053.3 `here: true` placeholder is rejected by the events/trigger-spec " +
    "validator (unknown-field) and by programs/filters.ts translateTriggerFilter (\"Unsupported filter field " +
    "here\"), so the CardProgram trigger cannot register through the merged RIFT-257 adapter; (2) the count still lacks the " +
    "Mode-of-Play teammate relation of 471.1.a / 315.2.b.3: no merged ObjectFilter / PlayerSelector / Expr expands " +
    "controller: you-or-ally into the controller and allies. The actual count path is evaluateExpression -> queryObjects: " +
    "it already queries Battlefield snapshots and resolves exclude: self, without calling translateObjectFilter. " +
    "Golden execution changes only controller to A, keeps the count expression and exclude anchor, and correctly draws " +
    "0/1/2 cards for 0/1/2 other A-controlled Battlefields; the self Battlefield, enemy Battlefields and units do not count. " +
    "The printed you-or-ally filter stays unchanged in this program pending teammate semantics. Data issue (not modified): the catalog text " +
    "ends with two periods (control..), recorded unresolved in docs/plans/survey/data-issues-recheck.md; sourceText keeps the " +
    "catalog spelling verbatim.",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "conquer",
        // "here" is this Battlefield (053.3) and "you" its Controller
        // (190.6.d); sibling battlefield programs keep the same placeholder
        // spelling while battlefield-relative trigger filtering is missing.
        filter: { event: "conquer", here: true, player: "controller" }
      },
      optional: false,
      body: [
        {
          // "draw 1 for each other battlefield you or allies control": one draw
          // whose amount is the size of the qualifying set, read at resolution
          // (414.1 / 414.3, contract 3.6). The other/self exclusion is supported
          // by the count path; the missing teammate relation is kept as the
          // you-or-ally placeholder (see judgeReason).
          id: "seat-of-power.draw-per-battlefield",
          op: "effect.draw",
          args: {
            amount: {
              kind: "count",
              subject: "battlefields",
              filter: {
                type: "battlefield",
                controller: "you-or-ally",
                exclude: "self"
              }
            }
          }
        }
      ]
    }
  ],
  sourceText:
    "When you conquer here, draw 1 for each other battlefield you or allies control.."
} satisfies CardProgram;

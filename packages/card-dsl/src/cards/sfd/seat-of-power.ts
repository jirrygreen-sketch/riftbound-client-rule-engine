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
 * Status: judge-required. Three merged gaps, none approximated:
 * 1. no merged module emits conquer into the single event pipeline
 *    (scoring/scoring.ts returns triggerScore/triggerMethod flags that
 *    turn-executor-v2 consumes; the chain/pipeline emit sites cover only
 *    chain / card-played / showdown / cleanup / became-target), so the
 *    triggered ability cannot enter the chain. The filter's here placeholder
 *    is the 053.3 spelling the trigger-spec validator rejects
 *    (RIFT-31/RIFT-33, contract 7.2 batch 5).
 * 2. the count subject "other battlefields you or allies control" needs two
 *    things the frozen IR lacks: a Battlefield-object query population (the
 *    merged reference kernel's filter only matches snapshots of Board units;
 *    no module produces Battlefield objects into a query) and the teammate
 *    ("allies") relation, which exists only in Modes of Play with Teams
 *    (471.1.a, 315.2.b.3) and is modelled by no merged ObjectFilter /
 *    PlayerSelector / Expr; "other" would use the exclude anchor, which the
 *    primitive selector resolver implements, but there is no population to
 *    exclude from.
 * 3. the production chain query path has no battlefield-object source either.
 * The trigger + count + draw shape is recorded below so the missing pieces stay
 * auditable; the draw half alone is executed by the golden test with an
 * explicit count, and the data issue (the extra period) is reported, not fixed.
 */
export default {
  canonicalCardId: "card.hash-8ad41dd9ba742358d12656164c456e4f9cc43b4712fcb9c9f120661d5c208fac",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "Three merged gaps, none approximated. (1) No merged module emits conquer into the single event pipeline " +
    "(scoring/scoring.ts only returns triggerScore/triggerMethod flags for turn-executor-v2), so the Conquer Effect " +
    "(383.4.c / 473.2.a) cannot enter the chain; the filter here placeholder is the 053.3 spelling assertTriggerSpec " +
    "rejects (RIFT-31/RIFT-33, contract 7.2 batch 5). (2) The count subject needs a Battlefield-object query population " +
    "and the teammate relation of 471.1.a / 315.2.b.3: the merged reference kernel's filter matches Board-unit snapshots " +
    "only (no Battlefield object source), and no merged ObjectFilter / PlayerSelector / Expr models allies (Modes of Play " +
    "with Teams only). The exclude anchor exists in the primitive selector resolver, but the population it must exclude " +
    "from does not exist. (3) The production chain query path has no battlefield-object source either. The merged draw " +
    "primitive and the count-driven amount are exercised by the golden test with an explicit count; the printed effect " +
    "cannot run end to end yet. Data issue (not modified): the catalog text ends with two periods (control..), recorded " +
    "unresolved in docs/plans/survey/data-issues-recheck.md; sourceText keeps the catalog spelling verbatim.",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "conquer",
        // "here" is this Battlefield (053.3) and "you" its Controller
        // (190.6.d); sibling battlefield programs keep the same placeholder
        // spelling while the conquer pipeline is unmerged.
        filter: { event: "conquer", here: true, player: "controller" }
      },
      optional: false,
      body: [
        {
          // "draw 1 for each other battlefield you or allies control": one draw
          // whose amount is the size of the qualifying set, read at resolution
          // (414.1 / 414.3, contract 3.6). The filter records the missing pieces
          // (other / you-or-allies) so the intended set stays reviewable; it is
          // not executable data (see judgeReason).
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

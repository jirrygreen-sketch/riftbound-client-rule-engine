import type { CardProgram } from "../../ir/index.js";

/**
 * Back-Alley Bar (ogn-277-298) — Battlefield, domainless.
 *
 * "When a unit moves from here, give it +1 :rb_might: this turn."
 *
 * CR v1.5 anchors:
 * - 421.1 / 449.1 / 449.2: Move is the action that changes a Permanent's
 *   Location; the "object-moved" timing point carries the movement payload
 *   (fromKind / fromLocationId / toKind / toLocationId, see
 *   events/timing-points.ts), and "from here" is that payload's origin.
 * - 458 / 458.1: a Recall is not a Move and does not trigger Move abilities,
 *   so the trigger keys on the Move timing point rather than on a generic
 *   location change.
 * - 355.10.c: the moved unit is mentioned only inside the trigger condition
 *   ("a unit moves from here"), so it is not a target; there is no Finalize
 *   target choice for this ability.
 * - 122.5 / 703: "+1 [M] this turn" is a Might modification, not a Buff
 *   counter; contract §3.6's closed GameAction set has no might-modification
 *   action, and effect.buff documents that temporary Might changes belong to
 *   the layers system's continuous.might (the same gap recorded for
 *   sfd/danger-zone and ogn/stupefy).
 *
 * Status rationale (contract §3.1, cards README §2): two gaps, neither
 * approximated:
 * - the effect: no merged primitive performs a temporary Might modification
 *   with an end-of-turn duration (adding a Buff counter would be a different,
 *   removable Game Object per 702–704);
 * - the affected object: "it" is the unit from the trigger payload. The frozen
 *   ObjectSelector set is self / source / target / pick / linked, and none of
 *   them can name a triggering event's object, so the body cannot reference its
 *   subject today (recorded as a contract change request in the task reply).
 *
 * The trigger and the intended layers-contract body shape are kept so the
 * missing pieces stay auditable.
 */
export default {
  canonicalCardId: "card.hash-493d66d1c2a0fe93d708e9d2f3e005dc5a57140526eb8080cdad1ce0977c081a",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "Missing the temporary Might modification: contract 3.6's closed GameAction set has no might-modification action and effect.buff documents that 'gets +1 [M] this turn' belongs to the layers system's continuous.might, which no merged instruction consumes (a Buff counter would be a different Game Object per CR 702-704 and is not substituted). Additionally the affected object is the unit from the trigger payload, and the frozen ObjectSelector set (self/source/target/pick/linked) cannot name a triggering event's object. Dependencies: the layers/continuous.might primitive workstream, an event-object selector (contract change request), and the Move timing-point trigger pipeline that must filter on the origin location and exclude Recalls (CR 458.1, RIFT-33 scenarios-triggers / RIFT-31 scenarios-scoring).",
  sourceText: "When a unit moves from here, give it +1 :rb_might: this turn.",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "object-moved",
        // "from here": the Move's origin is this battlefield.
        filter: {
          event: "object-moved",
          details: { fromKind: "battlefield", fromLocationId: "self" }
        }
      },
      optional: false,
      body: [
        {
          // "give it +1 [M] this turn" — layers-contract shape; see
          // judgeReason for the two missing pieces (no might primitive, no
          // selector for the trigger payload's object).
          id: "back-alley-bar.give-might",
          op: "effect.might-modify",
          args: {
            amount: { kind: "constant", value: 1 },
            duration: { kind: "constant", value: "this-turn" },
            appliesTo: { kind: "constant", value: { triggerObject: "object-moved" } }
          }
        }
      ]
    }
  ]
} satisfies CardProgram;

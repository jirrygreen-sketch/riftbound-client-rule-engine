import type { CardProgram } from "../../ir/index.js";

/**
 * Hallowed Tomb (ogn-281-298) — Battlefield, domainless.
 *
 * "When you hold here, you may return your Chosen Champion from your trash to
 *  your Champion Zone if it is empty."
 *
 * CR v1.5 anchors:
 * - 383.4.d / 383.4.d.1 / 383.4.d.2.b: "When you hold here …" is a Hold
 *   Effect (timing point "hold", emitted by scoring/, rule refs 315.2.b.2 /
 *   471.2 / 473.2.b); "you" is this battlefield's Controller (190.6.a/190.6.d),
 *   and "you may …" makes it optional (contract §3.1 `optional`, written with
 *   the §3.9 `choice.optional` body wrapper).
 * - 355.10.a / 355.10.a.1: the returned card sits in a public zone (108.2.d
 *   trash, 108.3.e Champion Zone), so "your Chosen Champion from your trash"
 *   is a target — the same shape the rules give for "return a unit from your
 *   trash to your hand" — and it is revalidated when the ability resolves.
 * - 108.3.b / 108.3.c / 108.3.c.1: the Champion Zone holds the Chosen
 *   Champion, cannot normally be returned to, and accepts a return only while
 *   no card is in it; that is the printed "if it is empty".
 * - 108.3.a / 108.3.e: each player has their own Champion Zone and its cards
 *   are public, so "your" is the ability controller.
 * - 103.3.a.3: Chosen Champion status follows the specific card chosen during
 *   deck building, not a characteristic of the printing.
 *
 * Status rationale (contract §3.1, cards README §2): four separate gaps, none
 * approximated:
 * - the EffectIR engine ZoneId / ZoneDestination vocabulary has no champion-zone member
 *   (GameAction `move-zone` lists hand/deck-top/deck-bottom/trash/banishment/
 *   base/battlefield; effect.zone's destination list is the same set), so the
 *   return destination cannot be named. effect.exhaust.ts already records the
 *   same contract gap for legend-zone/champion-zone;
 * - ObjectFilter has no Chosen Champion predicate (no field for 103.3.a.3
 *   status), so the target cannot be restricted to that card;
 * - count/compare already evaluate zone counts, but "if it is empty" still
 *   depends on Champion Zone being available to the query and move contracts.
 *
 * - the hold filter's `here` relation has no adapter that binds the scoring
 *   event's battlefield identity to this source.
 * The trigger, optional wrapper and intended destination stay explicit so the
 * missing contract pieces remain auditable; nothing here executes today.
 */
export default {
  canonicalCardId: "card.hash-92c11a0988b326e10a408e7574612b504d23ae5df1697436070ec33c5d1e6a70",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "The EffectIR ZoneId/ZoneDestination and effect.zone still lack Champion Zone routing (CR 108.3); " +
    "ObjectFilter/programs/filters.ts lack the physical Chosen Champion marker (103.3.a.3). The empty-zone " +
    "count/compare query (108.3.c.1) needs that unsupported zone. programs/filters.ts also cannot bind the " +
    "hold event here relation to this source battlefield (383.4.d).",
  sourceText:
    "When you hold here, you may return your Chosen Champion from your trash to your Champion Zone if it is empty.",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "hold",
        filter: { event: "hold", here: true, player: "controller" }
      },
      optional: true,
      body: [
        {
          // §3.9: the "may" is the optional wrapper; the instruction it gates
          // lives inside `body`.
          id: "hallowed-tomb.opt-in",
          op: "choice.optional",
          args: {
            prompt: { kind: "constant", value: "Return your Chosen Champion to your Champion Zone?" },
            body: {
              kind: "constant",
              value: [
                {
                  id: "hallowed-tomb.return-champion",
                  op: "effect.zone",
                  // "if it is empty" (108.3.c.1): the condition belongs to this
                  // instruction; its count query
                  // still needs Champion Zone support — see
                  // judgeReason.
                  condition: {
                    kind: "compare",
                    left: {
                      kind: "count",
                      subject: "objects",
                      filter: { zone: "champion-zone", owner: "controller" }
                    },
                    operator: "eq",
                    right: { kind: "constant", value: 0 }
                  },
                  args: {
                    target: { kind: "constant", value: "chosen-champion-in-trash" },
                    to: { kind: "constant", value: "champion-zone" },
                    amount: { kind: "constant", value: 1 }
                  },
                  targets: [
                    {
                      id: "chosen-champion-in-trash",
                      filter: {
                        type: "unit",
                        zone: "trash",
                        owner: "controller",
                        chosenChampion: true
                      },
                      min: 1,
                      max: 1,
                      selection: "one"
                    }
                  ]
                }
              ]
            }
          }
        }
      ]
    }
  ]
} satisfies CardProgram;

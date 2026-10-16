import type { CardProgram } from "../../ir/index.js";

/**
 * Solari Shieldbearer (ogn-051-298) — Unit, 3 energy, Might 2, Calm, Mount Targon.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, ogn-051-298):
 *   When you play me, stun a unit. (It doesn't deal combat damage this turn.)
 *
 * Rules evidence (Core Rules v1.5):
 * - "When you play me" is the Play Effect trigger (383.4.a, 383.4.a.1); it is
 *   put on the chain after the permanent is finalized and enters the board
 *   (383.4.a.2), i.e. the merged `card-played` timing point filtered to this
 *   card (see the merged ogn/pit-rookie.ts).
 * - "stun a unit" specifically chooses Game Objects, so it is a Choice made at
 *   Finalize (355.5; the rules use "Stun a unit at a battlefield" as their own
 *   example of a Choice), and the object mentioned is a target (355.10). One
 *   unit means one TargetSpec with min/max 1 and selection "one".
 * - "a unit" is not restricted to enemy units, so the filter only requires the
 *   object to be a Unit on the Board (424.1); an already-Stunned unit is still
 *   a legal choice that simply does nothing (424.1.a.1), which is exactly how
 *   the merged effect.stun primitive reports it (executed with count 0 and
 *   alreadyStunned 1). The reminder text ("It doesn't deal combat damage this
 *   turn") is 424.1.b plus the end-of-turn cleanup of 424.1.a.2, both engine
 *   behavior — not card instructions.
 *
 * Status: executable. Both the trigger and the body use merged pieces: the
 * card-played timing point is emitted by chain/engine.ts for played units, and
 * effect.stun (RIFT-119) is registered with target / pick / choose support and
 * covered by execution tests. Note the pre-existing wiring gap: the production
 * chain adapter (chain/interpreter-adapter.ts LITERAL_FIELDS) does not decode
 * `effect.stun`'s `target` field, so the production path still passes an Expr
 * and throws; that gap is reported as a contract change request and the golden
 * test exercises the same instruction through the interpreter's default
 * registry, matching the merged sfd precedent for effect.stun cards.
 */
export default {
  canonicalCardId: "card.hash-8c930fbf9acbe41ff1f082ade2f82f6957381af2cbf72e31fed54304747e581b",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "card-played",
        filter: { event: "card-played", filter: { role: "self" } }
      },
      optional: false,
      body: [
        {
          id: "solari-shieldbearer.stun-a-unit",
          op: "effect.stun",
          args: { target: { kind: "constant", value: "solari-shieldbearer.unit" } },
          targets: [
            {
              id: "solari-shieldbearer.unit",
              // 424.1: only a Unit on the Board can be Stunned; "a unit" is not
              // restricted to enemies (355.9.b).
              filter: { type: "unit", zone: "board" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ],
  sourceText: "When you play me, stun a unit. (It doesn't deal combat damage this turn.)"
} satisfies CardProgram;

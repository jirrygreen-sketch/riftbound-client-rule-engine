import type { CardProgram, Condition, Instruction } from "../../ir/index.js";

/**
 * Fiora, Peerless (sfd-110-221) — fiora-sfd (RIFT-95).
 *
 * "When I attack or defend one on one, double my Might this combat."
 *
 * Rules evidence (Core Rules v1.5):
 * - 383.4.e / 323.2 / 466.2.c: "When I attack" is the attack-declared
 *   timing point; the same ability fires on defense-declared for "or defend".
 * - 740.2.b: a unit is one on one when it and the enemy unit at the same
 *   location are both alone. In Duel this is exactly one friendly and one
 *   enemy board unit at the source location. Existing count/sameLocationAs
 *   expressions can evaluate that condition; no dedicated opcode is needed.
 * - 433.1 / 433.1.a: "double my Might" is Doubling — increase the numeric
 *   attribute by its CURRENT value. The merged continuous.might instruction
 *   registers an arithmetic-layer modification and the merged
 *   duration vocabulary maps "this combat" to end-of-combat (468.7.c), so the
 *   body is authored as condition.value (read this unit's Might at
 *   resolution) followed by continuous.might on the source.
 *
 * RIFT-877 verification: CombatFlow establishes both roles and publishes the
 * same-batch attack-declared/defense-declared wave inside its CR 466.2
 * transaction. The default EventPipeline evaluates this authored condition for
 * each captured source with relative controller/opponent queries and a
 * source-location anchor. The triggered Chain item then resolves the authored
 * body through its real Finalize/Resolve path; the end-of-combat layer effect
 * expires on combat-end (CR 468.7.c).
 */
const constant = <T,>(value: T) => ({ kind: "constant" as const, value });

// CR 740.2.a/b: each opposing unit must be alone at the same location.
const oneOnOne: Condition = {
  kind: "all",
  conditions: (["self", "opponent"] as const).map(controller => ({
    kind: "compare",
    left: {
      kind: "count",
      subject: "units",
      filter: { type: "unit", zone: "board", controller, sameLocationAs: "source" }
    },
    operator: "eq",
    right: constant(1)
  }))
};

const doublingBody = (readId: string, applyId: string): Instruction[] => [
  {
    // 433.1: Doubling uses the attribute's current value, read at resolution.
    id: readId,
    op: "condition.value",
    args: {
      value: { kind: "object-property" as const, object: "source" as const, property: "might" },
      key: constant("might")
    }
  },
  {
    // 433.1.a / 468.7.c: an arithmetic-layer modification that lasts for the
    // combat; the merged duration alias maps "this-combat" to end-of-combat.
    id: applyId,
    op: "continuous.might",
    linkedTo: readId,
    args: {
      amount: { kind: "linked-value", instructionId: readId, key: "might" },
      duration: constant("this-combat"),
      appliesTo: constant("self")
    }
  }
];

export default {
  canonicalCardId: "card.hash-6bde2e2c542ff8fc1a7a2f9204df7e6c58a05a53ad98c0a31d69927be053b77f",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "attack-declared",
        filter: {
          event: "attack-declared",
          filter: { source: "self" }
        },
        condition: oneOnOne,
        once: "per-combat"
      },
      optional: false,
      body: doublingBody("fiora-peerless.attack.read-might", "fiora-peerless.attack.double-might")
    },
    {
      kind: "triggered",
      trigger: {
        at: "defense-declared",
        filter: {
          event: "defense-declared",
          filter: { source: "self" }
        },
        condition: oneOnOne,
        once: "per-combat"
      },
      optional: false,
      body: doublingBody("fiora-peerless.defend.read-might", "fiora-peerless.defend.double-might")
    }
  ],
  sourceText: "When I attack or defend one on one, double my Might this combat."
} satisfies CardProgram;

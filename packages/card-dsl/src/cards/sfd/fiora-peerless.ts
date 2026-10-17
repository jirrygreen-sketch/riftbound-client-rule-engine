import type { CardProgram, Instruction } from "../../ir/index.js";

/**
 * Fiora, Peerless (sfd-110-221) — fiora-sfd (RIFT-95).
 *
 * "When I attack or defend one on one, double my Might this combat."
 *
 * Rules evidence (Core Rules v1.5):
 * - 383.4.e / 323.2 / 466.2.c: "When I attack" is the attack-declared
 *   timing point; the same ability fires on defense-declared for "or defend".
 * - 740.2.b: a unit is one on one when it and the enemy unit at the same
 *   location are both alone. The trigger-level condition still has to read
 *   that combat designation pair; nothing in the merged layers/predicate set
 *   exposes it (see status).
 * - 433.1 / 433.1.a: "double my Might" is Doubling — increase the numeric
 *   attribute by its CURRENT value. The merged continuous.might instruction
 *   (RIFT-258) registers an arithmetic-layer modification and the merged
 *   duration vocabulary maps "this combat" to end-of-combat (468.7.c), so the
 *   body is authored as condition.value (read this unit's Might at
 *   resolution) followed by continuous.might on the source.
 *
 * Status (cards/README.md §2): judge-required. The Might half is executable and
 * the golden test runs it for real (the layered arithmetic engine really
 * doubles the effective Might), but the printed "one on one" gate is not: the
 * merged ObjectSnapshot carries combatRole (contract 3.8 item 1) yet nothing
 * compares the two lone opposing units at one location, and the attack-/
 * defense-declared timing points still have no producer (combat/ throws its
 * combat-start transaction; timing-point-producers.md lists both as 待后续).
 * Depends on RIFT-124 (combat role designation transaction) and the
 * one-on-one predicate. Not approximated: the gate is not dropped and the
 * Might change is not written as a Buff counter (702).
 */
const constant = <T,>(value: T) => ({ kind: "constant" as const, value });

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
  status: "judge-required",
  judgeReason:
    "The Might half is now executable (continuous.might + end-of-combat duration, 433.1/468.7.c) and is really executed in the golden test, but the printed one-on-one gate (740.2.b) is still missing: no merged predicate compares the two lone opposing units at one location, so the trigger condition cannot be evaluated. " +
    "The attack-declared/defense-declared timing points also still have no producer — combat/ raises combat-start-transaction and docs/rules/timing-point-producers.md lists attack-declared/defense-declared as 待后续. " +
    "依赖：RIFT-124（combat 角色判定事务）与 one-on-one 谓词。不近似实现（不丢掉 gate，也不用 Buff 计数冒充 Might 翻倍）。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "attack-declared",
        filter: {
          event: "attack-declared",
          filter: { source: "self" }
        },
        condition: {
          kind: "expression",
          value: { kind: "constant", value: "one-on-one" }
        },
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
        condition: {
          kind: "expression",
          value: { kind: "constant", value: "one-on-one" }
        },
        once: "per-combat"
      },
      optional: false,
      body: doublingBody("fiora-peerless.defend.read-might", "fiora-peerless.defend.double-might")
    }
  ],
  sourceText: "When I attack or defend one on one, double my Might this combat."
} satisfies CardProgram;

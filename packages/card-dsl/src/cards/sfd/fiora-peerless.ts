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
 * Status: judge-required. The gate and Might body both execute in isolation.
 * CombatFlow.startCombat still blocks on the atomic role/timing transaction
 * (466.2), so neither attack-declared nor defense-declared has a producer.
 * The event host also needs its testTrigger adapter to evaluate this authored
 * condition when collecting the trigger (383.2), rather
 * than treating the old literal "one-on-one" placeholder as a truthy value.
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
  status: "judge-required",
  judgeReason:
    "one-on-one（740.2.a/740.2.b）现可由同地友方/敌方单位各为 1 的 count 条件表达，已有解释器边界测试；continuous.might 也已真实翻倍并使用 end-of-combat 时长（433.1/468.7.c）。剩余缺口是 CombatFlow.advance 的 combat-start-transaction（466.2 的同时角色/时点事务），attack-declared/defense-declared 尚无生产者；生产事件宿主还必须提供 testTrigger，在触发收集时求值此条件（383.2）。不再将专用 one-on-one opcode 当作必要依赖，整卡保持 judge-required。",
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

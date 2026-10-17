import type { CardProgram } from "../../ir/index.js";

/**
 * Adaptatron (ogn-056-298) — Unit, 4 energy, Might 3, Calm, Mech/Piltover.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, ogn-056-298):
 *   When I conquer, you may kill a gear. If you do, buff me. (If I don't have
 *   a buff, I get a +1 :rb_might: buff.)
 *
 * Rules evidence (Core Rules v1.5):
 * - "When I conquer" is a Conquer Effect (383.4.c, 383.4.c.1): the `conquer`
 *   timing point (383.4.c.2.a; 471.1, 473.2.a), now emitted by the TurnFlow
 *   Score wave, filtered to this unit taking part in the conquering.
 * - "you may kill a gear" is an optional decision inside the effect. Per
 *   contract 3.9 a "may" is `choice.optional` wrapping the instructions it
 *   gates — not a bare choice with a `linkedTo` follow-up. "a gear" is a
 *   choice of a specific Game Object (355.5, 355.10), so it is a TargetSpec
 *   (355.7) for the merged effect.kill primitive, which revalidates it at
 *   resolution (359.3.e).
 * - "If you do" directly references that game action (359.3.e.14.b example: a
 *   replaced death cancels the linked follow-up), so the buff is linked to the
 *   kill and gated on the actual kill result: the merged effect.kill writes the
 *   `killed` receipt, and effect.buff is merged.
 * - "buff me" places the single Buff counter of 702.2.a/702.3; the parenthetical
 *   is reminder text for 702/703 (+1 Might while buffed), not an extra effect.
 *   The target declares the contract 3.6 symbolic "self" through an `object`
 *   filter anchor; production target translation still rejects that field.
 *
 * Status: judge-required. The conquer wave supplies the scoring player and
 * battlefieldId, but no participant object or dynamic host-location predicate
 * (383.4.c.2.a). The body also cannot bind its object:self target filter, and
 * the chain rejects targets nested inside choice.optional before Finalize.
 * Golden tests exercise the supported body only; they do not bypass these
 * production trigger and target lifecycle gaps.
 */
export default {
  canonicalCardId: "card.hash-efa44994f07966ad8095ddd1f56f9c20b1246888b3f037a54a196793f2cb0f4b",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "仍缺自身征服范围（CR 383.4.c.1/383.4.c.2.a）：turn/flow.ts 的 conquer 波只有 player 与 details.battlefieldId，没有参战单位 object；translateTriggerFilter 的 self 锚点不能关联宿主所在战场与这次征服，player:self 会误触发其它战场的副本。另外 programs/filters.ts 的 translateObjectFilter 拒绝 buff-me 的 object:self 目标锚点；嵌套 choice.optional 内的目标尚无 Finalize 生命周期（chain/engine.ts 只收集顶层目标），不能让解释器在结算时补选目标。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "conquer",
        // 383.4.c.1: the unit must have been present at the conquering
        // battlefield. "conquered" is the validator's event name; the merged
        // binding (RIFT-257) translates the nested self anchor into
        // object:{objectId: host}. The conquered emission still carries no
        // participant object, so this scoping cannot match today — the gap is
        // recorded in judgeReason and proven by the test below.
        filter: { event: "conquered", filter: { source: "self" } }
      },
      optional: false,
      body: [
        {
          // §3.9: the printed "you may" wraps the instruction it gates.
          id: "adaptatron.may-kill-gear",
          op: "choice.optional",
          args: {
            prompt: { kind: "constant", value: "Kill a gear to buff Adaptatron?" },
            body: {
              kind: "constant",
              value: [
                {
                  id: "adaptatron.kill-gear",
                  op: "effect.kill",
                  args: { target: { kind: "constant", value: "adaptatron.gear" } },
                  targets: [
                    {
                      id: "adaptatron.gear",
                      // 429.1/429.2.a: a gear on the Board; "a gear" is a
                      // choice of a specific game object (355.5, 355.10).
                      filter: { type: "gear", zone: "board" },
                      min: 1,
                      max: 1,
                      selection: "one"
                    }
                  ]
                },
                {
                  // "If you do, buff me." — gated on the actual kill
                  // (359.3.e.14.b); effect.kill publishes the `killed`
                  // receipt, so a replaced death leaves the buff unexecuted.
                  id: "adaptatron.buff-me",
                  op: "effect.buff",
                  linkedTo: "adaptatron.kill-gear",
                  condition: {
                    kind: "compare",
                    left: {
                      kind: "linked-value",
                      instructionId: "adaptatron.kill-gear",
                      key: "killed"
                    },
                    operator: "ne",
                    right: { kind: "constant", value: [] }
                  },
                  args: {
                    mode: { kind: "constant", value: "buff" },
                    target: { kind: "constant", value: "adaptatron.me" }
                  },
                  targets: [
                    {
                      id: "adaptatron.me",
                      filter: { object: "self", type: "unit" },
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
  ],
  sourceText:
    "When I conquer, you may kill a gear. If you do, buff me. (If I don't have a buff, I get a +1 :rb_might: buff.)"
} satisfies CardProgram;

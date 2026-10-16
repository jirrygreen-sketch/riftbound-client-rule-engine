import type { CardProgram } from "../../ir/index.js";

/**
 * Adaptatron (ogn-056-298) — Unit, 4 energy, Might 3, Calm, Mech/Piltover.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, ogn-056-298):
 *   When I conquer, you may kill a gear. If you do, buff me. (If I don't have
 *   a buff, I get a +1 :rb_might: buff.)
 *
 * Rules evidence (Core Rules v1.5):
 * - "When I conquer" is a Conquer Effect (383.4.c, 383.4.c.1): the merged
 *   `conquer` timing point filtered to this unit taking part in the conquering
 *   (383.4.c.2.a; 471.1, 473.2.a).
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
 *   The target is anchored to the ability host with the contract 3.6 symbolic
 *   "self" selector through the merged `object` filter anchor (the merged
 *   sfd/rumble-hotheaded and sett-brawler shape).

 * Status: judge-required. The two instruction primitives are merged and are
 * executed by the golden test, but the trigger cannot fire in the merged
 * engine: the `conquer` timing point is defined in the closed enum but no
 * production module emits it (the scoring/ path in engine-core emits no
 * pipeline timing today; the duel engagement executor only gates its own
 * internal step names). Dependencies: the conquer/scoring timing emission
 * (P0 contract 7.2 batch 5 / scoring workstream). Not approximated — the "if
 * you do" gate is written as a real kill-receipt condition rather than an
 * unconditional buff.
 */
export default {
  canonicalCardId: "card.hash-efa44994f07966ad8095ddd1f56f9c20b1246888b3f037a54a196793f2cb0f4b",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "触发无法进入链：conquer 时点（383.4.c、471.1/473.2.a）虽在 events/timing-points.ts 的封闭枚举里，但没有任何生产模块发射它" +
    "（engine-core 的 scoring/ 路径不发射触发管线时点，duel 侧只 gate 自己的步骤名）。" +
    "「you may kill a gear. If you do, buff me.」本体用已合入的 choice.optional + effect.kill（写 killed 回执）+ effect.buff（self 锚点）表达，" +
    "其中「If you do」按 359.3.e.14.b 直接引用该消灭动作、以 killed 回执判定，golden 已覆盖接受/拒绝/死亡被替代三条路径；" +
    "缺的只是 conquering 时点的发射方。依赖：conquer/scoring 时点发射（P0 契约 7.2 批 5 / scoring 工作流）。不近似实现。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "conquer",
        // 383.4.c.2.a: the unit must have been present at the conquering
        // battlefield; the merged event matcher binds "self" to this ability's
        // source (events/pipeline-match.ts).
        filter: { event: "conquer", filter: { source: "self" } }
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

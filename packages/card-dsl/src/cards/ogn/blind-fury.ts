import type { CardProgram } from "../../ir/index.js";

/**
 * Blind Fury (ogn-025-298) — Spell, 4 Energy + 2 Fury power, Fury.
 *
 * Printed text:
 *   [Action] (Play on your turn or in showdowns.)
 *   Each opponent reveals the top card of their Main Deck. Choose one and
 *   banish it, then play it, ignoring its cost. Then recycle the rest.
 *
 * Catalog evidence (packages/card-data/data/deck-catalog.json, dataVersion
 * 2026-10-12-official-gallery): energy 4, power 2 (Fury), might null, tags [].
 *
 * Status: judge-required. Three of the four clauses need merged machinery that
 * does not exist yet; the recycle step is expressible and is covered by the
 * golden test:
 * - "Each opponent reveals the top card of their Main Deck" binds one reveal per
 *   opponent. The merged effect.reveal takes a single player expression and has
 *   no each-opponent iteration; the iteration over the opponent set is the
 *   card's obligation and has no primitive. Reveal also picks its
 *   candidates with ctx.query and rejects a proper deck subset; an ordered
 *   zoneSlice-to-reveal-pick adapter is still needed for the actual top card.
 * - "Choose one and banish it" is a choice made during resolution from the cards
 *   revealed this way (355.18: choices not listed in 355 are made on
 *   resolution). The merged picks are finalized before resolution
 *   (finalizePick in engine-core/src/target/target-plan.ts) and effect.reveal
 *   links only the revealed references, not a resolution-time selection plan, so
 *   the choice-timing adapter is missing. The intended shape below uses a
 *   PickSpec over the linked revealed set; the golden tests execute the merged
 *   banish primitive, without claiming the subsequent ignoring-cost play.
 * - "play it, ignoring its cost": ignoring a printed cost sets the base Energy
 *   and Power costs to zero (356.1.b.1), and further additional costs or
 *   increases still apply afterwards (356.1.b.3). effect.play documents that it
 *   never derives printed costs and does not implement an ignored-cost rule; it
 *   only consumes an already-finalized cost plan. The merged cost pipeline can
 *   express an ignore-base rewrite (cost/cost-plan.ts), but no play/effect
 *   adapter turns this instruction into that plan, so the ignore-base wiring is
 *   missing and is not smuggled in as a zeroed plan.
 * - "Then recycle the rest" IS expressible: effect.recycle drops references that
 *   are no longer live, so recycling the linked revealed set after the chosen
 *   card has left that zone recycles exactly the remaining cards, and 417.1.c
 *   routes each card to its own owner's deck. The golden test exercises that
 *   step through the real primitives.
 * Steps that cannot execute use descriptive op/spelling placeholders so the
 * intended program stays reviewable.
 *
 * Dependencies: an each-opponent, zoneSlice-ordered reveal; a resolution-time
 * choice over a linked set; and the ignore-base wiring from effect.play into the
 * finalize cost plan.
 */
const blindFury = {
  canonicalCardId: "card.hash-5d9f81372ed036e6b436801528f2d8f8c5ebcc636cfa4c396219c28c446bdfac",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺少：(1) 按对手逐个绑定的 each-opponent 执行与 zoneSlice 牌库顶引用到 effect.reveal pick 的适配；" +
    "effect.reveal 对非手牌的真子集会拒绝，不能依赖 ctx.query 顺序。" +
    "(2) 从本次 linked revealed 集合在结算时选择一张（CR 355.18）的适配；finalizePick 锁于 Finalize，" +
    "解释器只转发外部 picks，effect.banish 的 choose 只支持过滤查询，尚不能限定到本次展示集合。" +
    "(3) effect.play 到嵌套打出 Finalize 费用计划的 ignore-base 适配（356.1.b.1），同时保留追加费用与增费（356.1.b.3）。",
  sourceText:
    "[Action] (Play on your turn or in showdowns.)\n" +
    "Each opponent reveals the top card of their Main Deck. Choose one and banish it, then play it, ignoring its cost. Then recycle the rest.",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      // Printed cost (energy 4 + 2 Fury power) comes from the catalog.
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 4 },
        power: { kind: "constant", value: 2 }
      },
      body: [
        {
          // "Each opponent reveals the top card of their Main Deck." The missing
          // per-opponent binding and deck-top ordering are explained in
          // judgeReason; this op is descriptive, not registered.
          id: "blind-fury.reveal-top-card-of-each-opponent",
          op: "effect.reveal-each-opponent",
          args: {
            zone: { kind: "constant", value: "deck" },
            from: { kind: "constant", value: "top" },
            count: { kind: "constant", value: 1 }
          }
        },
        {
          // "Choose one and banish it": one card out of the set revealed by the
          // previous instruction. The banish primitive is merged; the
          // resolution-time choice over that linked set is the judged part.
          id: "blind-fury.banish-chosen",
          op: "effect.banish",
          linkedTo: "blind-fury.reveal-top-card-of-each-opponent",
          args: {
            objects: { kind: "constant", value: { pick: "blind-fury.chosen-card" } }
          },
          picks: [
            {
              id: "blind-fury.chosen-card",
              options: [
                {
                  kind: "linked-value",
                  instructionId: "blind-fury.reveal-top-card-of-each-opponent",
                  key: "revealed"
                }
              ],
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          // "...then play it, ignoring its cost." Playing from Banishment is the
          // merged effect.play shape; the ignored-cost base modification
          // (356.1.b.1 / 356.1.b.3) belongs to the finalize cost plan.
          id: "blind-fury.play-chosen",
          op: "effect.play",
          linkedTo: "blind-fury.banish-chosen",
          args: {
            object: {
              kind: "linked-value",
              instructionId: "blind-fury.banish-chosen",
              key: "banishedObject"
            }
          }
        },
        {
          // "Then recycle the rest." effect.recycle drops the reference whose
          // object already left its zone, so this recycles exactly the revealed
          // cards that were not banished/played (417.1.c routes by owner).
          id: "blind-fury.recycle-the-rest",
          op: "effect.recycle",
          linkedTo: "blind-fury.banish-chosen",
          args: {
            objects: {
              kind: "linked-value",
              instructionId: "blind-fury.reveal-top-card-of-each-opponent",
              key: "revealed"
            }
          }
        }
      ]
    }
  ]
} satisfies CardProgram;

export default blindFury;

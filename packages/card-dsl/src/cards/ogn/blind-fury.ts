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
 *   no each-opponent iteration (RIFT-9 target.player; 133.3 says "opponent"
 *   refers to objects/players by characteristic, but the iteration over the set
 *   is the card's obligation and has no primitive). Reveal also picks its
 *   candidates with ctx.query, which the contract documents as not guaranteeing
 *   zone order, so "the top card" is not ordered by the merged primitive
 *   (contract 3.6 added ctx.zoneSlice for exactly this in RIFT-66, but
 *   effect.reveal does not use it yet).
 * - "Choose one and banish it" is a choice made during resolution from the cards
 *   revealed this way (355.18: choices not listed in 355 are made on
 *   resolution). The merged picks are finalized before resolution
 *   (finalizePick in engine-core/src/target/target-plan.ts) and effect.reveal
 *   links only the revealed references, not a resolution-time selection plan, so
 *   the choice-timing adapter is missing. The intended shape below uses a
 *   PickSpec over the linked revealed set; effect.banish and effect.play are
 *   merged and are exercised directly by the golden tests.
 * - "play it, ignoring its cost": ignoring a printed cost sets the base Energy
 *   and Power costs to zero (356.1.b.1), and further additional costs or
 *   increases still apply afterwards (356.1.b.3). effect.play documents that it
 *   never derives printed costs and does not implement an ignored-cost rule; it
 *   only consumes an already-finalized cost plan. The merged cost pipeline can
 *   express an ignore-base rewrite (cost/cost-plan.ts) but no merged producer
 *   turns this card's instruction into that plan, so the ignore-base wiring
 *   (RIFT-257 / RIFT-261) is missing and is not smuggled in as a zeroed plan.
 * - "Then recycle the rest" IS expressible: effect.recycle drops references that
 *   are no longer live, so recycling the linked revealed set after the chosen
 *   card has left that zone recycles exactly the remaining cards, and 417.1.c
 *   routes each card to its own owner's deck. The golden test exercises that
 *   step through the real primitives.
 * Steps that cannot execute use descriptive op/spelling placeholders so the
 * intended program stays reviewable.
 *
 * Dependencies: RIFT-9 target.player (each-opponent binding), zoneSlice-ordered
 * reveal, a resolution-time choice over a linked set, and the RIFT-257/261
 * cost-ignore wiring in the finalize cost plan.
 */
const blindFury = {
  canonicalCardId: "card.hash-5d9f81372ed036e6b436801528f2d8f8c5ebcc636cfa4c396219c28c446bdfac",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三个缺口：(1) 「Each opponent reveals the top card of their Main Deck」需要按对手逐个绑定的循环（RIFT-9 target.player），" +
    "已合入的 effect.reveal 只接受单个 player 表达式，且候选顺序来自 ctx.query（不保证区域内顺序），牌库顶语义需改用 ctx.zoneSlice（RIFT-66）；" +
    "(2) 「Choose one and banish it」是结算时从本次展示的集合中做选择（355.18），已合入的 picks 在 Finalize 前锁定" +
    "（target-plan finalizePick），effect.reveal 只链接展示到的引用、不产出结算期选择计划，缺 condition.result / 结算期选择原语；" +
    "(3) 「play it, ignoring its cost」是把印刷基础 Energy/Power 费置零（356.1.b.1，追加费用仍按 356.1.b.3 继续计算），" +
    "effect.play 文档明确既不推导印刷费用也不实现 ignore-cost 规则，只接受已 finalize 的费用计划；cost/cost-plan.ts 能表达 ignore-base 改写，" +
    "但没有已合入的生产方把本卡指令接成该费用计划（RIFT-257 卡牌程序绑定 / RIFT-261 费用指令）。" +
    "「Then recycle the rest」可表达：effect.recycle 丢弃已失效引用，故回收展示集合即回收其余牌（417.1.c 各自回各自牌库），该步有 golden 执行测试。",
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

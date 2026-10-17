import type { CardProgram } from "../../ir/index.js";

/**
 * ogn-244-298 Divine Judgment (Spell, Order, 7 energy + 2 Order power) — RIFT-143 shard 8.
 *
 * Catalog evidence (deck-catalog.json, dataVersion 2026-10-12-official-gallery):
 * cardType Spell, domains ["Order"], energy 7, power 2, might null.
 *
 * Printed text:
 *   Each player chooses 2 units, 2 gear, 2 runes, and 2 cards in their hands.
 *   Recycle the rest.
 *
 * Reading recorded here (and flagged as an open ruling): "Recycle the rest" is read
 * literally as the remainder of each chosen category, i.e. per player the chosen 2
 * units, 2 gear, 2 runes and 2 hand cards are kept and that player's remaining
 * units, gear, runes and hand cards are recycled (417.1: to the bottom of the
 * owner's Main Deck; 417.1.b: runes to that player's Rune Deck; 417.1.c: each player
 * recycles to their own decks). Whether "the rest" scopes to those four categories
 * or is meant more narrowly must be confirmed by a judge before the card becomes
 * executable.
 *
 * Status: judge-required. Every category choice is a resolution-time, per-player,
 * non-target choice:
 * - the choosers are all players (355.10.e: objects chosen in whole or in part by
 *   other players are not targeted; 355.10.a: hand cards are not public, so the
 *   hand choice can never be a target either); `ResolveContext.choose` asks one
 *   chooser per request and the IR cannot name runtime player ids, so the
 *   per-player iteration of contract 3.1/3.6 is missing;
 * - the four categories need four distinct non-target picks per player (2 units,
 *   2 gear, 2 runes, 2 hand cards); a PickSpec with hard-coded `options` cannot
 *   enumerate runtime objects, and the merged test/production kernels only accept
 *   caller-supplied option lists;
 * - "Recycle the rest" needs a complement selection (all units/gear/runes/hand
 *   cards outside the chosen set). effect.recycle only takes N from ONE zone
 *   (`from.zone` + `amount`) or a target/objects list, so it can express "recycle
 *   your 3 units" but not "recycle everything that was not kept", and no merged
 *   primitive splits the destination by card type (units/gear/hand cards -> Main
 *   Deck bottom; runes -> Rune Deck bottom, 417.1.a/417.1.b).
 * The structure below keeps the four pick specifications and the recycle-rest
 * shape so the remaining work is reviewable; nothing is approximated.
 */
const divineJudgment = {
  canonicalCardId: "card.hash-adf97d6260131adb3a3b5b54d1904b16d8330ea2476fe31e8652a57b081a380a",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「Recycle the rest」的指代范围需裁定（本文件按其字面读作四类保留集合的补集，需 judge 确认）；" +
    "缺多玩家顺序选择与非目标 pick 的运行时选项：choose 只支持单个 chooser，IR 无法命名运行时玩家；" +
    "四类选择（2 units / 2 gear / 2 runes / 2 cards in hand）都需要运行时对象集合（PickSpec.options 是静态值，" +
    "且手牌按 355.10.a 非公开、按 355.10.e 整套选择不是 target）。" +
    "「Recycle the rest」需要补集选择：effect.recycle 只能从单一区域取 N 张（from.zone + amount）或按 target/objects 列表，" +
    "无法表达「除保留集合外的全部」，也不区分目的地（units/gear/手牌→主牌库底、runes→符文牌库底，417.1.a/417.1.b/417.1.c）。" +
    "依赖：RIFT-357 的多玩家顺序选择与运行时 picks、补集 recycle 及按类型目的地分发；不近似实现。",
  abilities: [
    {
      kind: "play",
      body: [
        {
          // "Each player chooses 2 units, 2 gear, 2 runes, and 2 cards in their
          // hands." Four non-target picks per player; the per-player iteration is
          // the pending part.
          id: "divine-judgment-choose",
          op: "choice.each-player",
          args: {
            choosers: { kind: "literal", value: "each-player" },
            keptKey: { kind: "literal", value: "divine-judgment-kept" },
            choose: {
              kind: "literal",
              value: [
                { type: "unit", zone: "board", count: 2 },
                { type: "gear", zone: "board", count: 2 },
                { type: "rune", zone: "rune-zone", count: 2 },
                { type: "card", zone: "hand", count: 2 }
              ]
            }
          },
          picks: [
            {
              id: "divine-judgment-units",
              options: ["dynamic:units-on-board"],
              min: 0,
              max: 2,
              selection: "up-to",
              filter: { type: "unit", zone: "board" }
            },
            {
              id: "divine-judgment-gear",
              options: ["dynamic:gear-on-board"],
              min: 0,
              max: 2,
              selection: "up-to",
              filter: { type: "gear", zone: "board" }
            },
            {
              id: "divine-judgment-runes",
              options: ["dynamic:runes-in-rune-zone"],
              min: 0,
              max: 2,
              selection: "up-to",
              filter: { type: "rune", zone: "rune-zone" }
            },
            {
              id: "divine-judgment-hand",
              options: ["dynamic:cards-in-hand"],
              min: 0,
              max: 2,
              selection: "up-to",
              filter: { type: "card", zone: "hand" }
            }
          ]
        },
        {
          // "Recycle the rest." — complement of the kept sets, split by the
          // owner's card types (417.1.a/417.1.b/417.1.c).
          id: "divine-judgment-recycle-rest",
          op: "effect.recycle-rest",
          linkedTo: "divine-judgment-choose",
          args: {
            keptKey: { kind: "literal", value: "divine-judgment-kept" },
            zones: {
              kind: "literal",
              value: [
                { zone: "board", types: ["unit", "gear"], toDeck: "main" },
                { zone: "hand", types: ["card"], toDeck: "main" },
                { zone: "rune-zone", types: ["rune"], toDeck: "rune" }
              ]
            }
          }
        }
      ]
    }
  ],
  sourceText:
    "Each player chooses 2 units, 2 gear, 2 runes, and 2 cards in their hands. Recycle the rest."
} satisfies CardProgram;

export default divineJudgment;

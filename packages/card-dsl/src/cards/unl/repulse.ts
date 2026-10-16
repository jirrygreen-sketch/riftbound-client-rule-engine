import type { CardProgram } from "../../ir/index.js";

/**
 * Repulse (unl-106-219) — Spell, 1 energy + 1 power, Body.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, unl-106-219, verbatim):
 *   "[Reaction] (Play any time, even before spells and abilities resolve.)
 *    Choose a friendly unit at a battlefield. Counter an enemy spell or ability
 *    that chooses it and no other friendly unit."
 *
 * Rules evidence (Core Rules v1.5):
 * - [Reaction] (813) is declared as a keyword ability only; 813.1.b grants the
 *   card every Action permission and 813.1.c adds Closed State play on any
 *   player's turn. The expansion lives in effects/keywords/Reaction.ts
 *   (contract 3.7) and admission is chain-owned (contract 3.5).
 * - "Choose a friendly unit at a battlefield" chooses one specific Board unit,
 *   so it is a target (355.7 / 355.9.a.1); "at a battlefield" restricts which
 *   units are legal rather than adding a second target (355.10.b, whose example
 *   is "Kill a unit at a battlefield" — the unit is the target, not the
 *   battlefield). The filter uses the merged location spelling
 *   `location: "battlefield"` (ogn/gust, ogn/incinerate).
 * - "an enemy spell or ability" is a second target: 355.9.a.2 keeps "spell" on
 *   the Chain and 355.9.a allows a finalized ability on the Chain as well, so
 *   the filter is a Chain object controlled by an opponent.
 * - "that chooses it and no other friendly unit" is the targeting restriction
 *   of that second target (355.9.b): only a chain item whose locked target set
 *   contains the chosen friendly unit and no other unit controlled by this
 *   player's team is a legal choice. The rules only expose that set through the
 *   finalized chain item (359.3.e.9.a reasons about mistargeted choices by
 *   zone), and the merged ObjectFilter vocabulary has no predicate for it; the
 *   frozen IR cannot read a chain item's target list either. The restriction is
 *   therefore recorded with descriptive keys that no merged code evaluates (the
 *   same device ogn/defy uses for its printed-cost restriction) instead of
 *   dropping it, which would let Repulse counter any enemy spell.
 * - "Counter" itself is the merged effect.counter primitive (426.1-426.3: the
 *   countered card does nothing, is cleared from the Chain, and its costs are
 *   not refunded); the golden test executes that half against a locked Chain
 *   target and against a stale one.
 *
 * status = judge-required (README section 2): the restriction predicate
 * "chooses it and no other friendly unit" has no evaluator, so the card cannot
 * be played as printed. Neither is approximated: a filter without it would
 * claim the card can counter arbitrary enemy spells and abilities.
 *
 * Dependencies: a target predicate over a finalized chain item's locked target
 * set (RIFT-90 target plan / chain target locking, contract 3.8's target-info
 * work), the `target.player`-class chain-item target info work in engine batch 4.
 */
export default {
  canonicalCardId:
    "card.hash-37a5883a0f15a4118620e230230c119a9ac1e87495ffa0716a061bf8d9c2422f",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺「该法术或能力只选择了这一个友方单位、没有选择其他友方单位」的目标谓词（355.9.b 的 targeting " +
    "restriction；359.3.e.9.a 只按区域讨论被误选的目标）：这个限制读取的是链上项 Finalize 锁定的目标集合，" +
    "而合并的 ObjectFilter 词表没有任何读取链上项目标集合的字段，冻结的 IR 也没有读取链上项目标列表的表达式" +
    "（TargetSpec.filter 只能逐键比较特征；目标计划 RIFT-90 未提供该谓词）。本文件用未被任何合并代码求值的描述性键" +
    "（chosenFriendlyUnit / noOtherFriendlyUnitChosen，与 ogn/defy 的 energyMax/powerMax 同一做法）保留该限制，" +
    "不删掉限制冒充「反制任意敌方法术」（那是被禁止的近似实现）。" +
    "依赖：链上项锁定目标集合的谓词（RIFT-90 target plan / chain 目标锁定；引擎批 4 的目标信息）。" +
    "已合入并由 golden 真实执行的部分：effect.counter（426.1–426.3）反制链上法术，[Reaction] 关键词声明（813）。",
  abilities: [
    { kind: "keyword", keyword: "reaction" },
    {
      kind: "play",
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 1 },
        power: { kind: "constant", value: 1 }
      },
      body: [
        {
          id: "repulse.counter-enemy-spell",
          op: "effect.counter",
          args: {
            target: {
              kind: "constant",
              value: "repulse.enemy-spell-or-ability"
            }
          },
          targets: [
            {
              // "Choose a friendly unit at a battlefield": a real targeting
              // choice (355.7), locked at Finalize (355.8).
              id: "repulse.friendly-unit",
              filter: {
                type: "unit",
                controller: "controller",
                zone: "board",
                location: "battlefield"
              },
              min: 1,
              max: 1,
              selection: "one"
            },
            {
              // "an enemy spell or ability": a finalized spell or ability on
              // the Chain (355.9.a / 355.9.a.2) controlled by an opponent.
              // chosenFriendlyUnit / noOtherFriendlyUnitChosen are the
              // descriptive part of the 355.9.b restriction; no merged
              // predicate evaluates them, so this group is not legally
              // finalizable today (see judgeReason).
              id: "repulse.enemy-spell-or-ability",
              filter: {
                type: ["spell", "ability"],
                zone: "chain",
                controller: "opponent",
                chosenFriendlyUnit: "repulse.friendly-unit",
                noOtherFriendlyUnitChosen: true
              },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ],
  sourceText:
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "Choose a friendly unit at a battlefield. Counter an enemy spell or ability " +
    "that chooses it and no other friendly unit."
} satisfies CardProgram;

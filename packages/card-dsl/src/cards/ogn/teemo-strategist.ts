import type { CardProgram } from "../../ir/index.js";

/**
 * Teemo, Strategist (ogn-121-298) — Unit, 2 energy, 1 power (Mind), 2 Might.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, ogn-121-298):
 *   [Hidden] (Hide now for :rb_rune_rainbow: to react with later for
 *   :rb_energy_0:.)
 *   When I defend or I'm played from [Hidden], reveal the top 5 cards of your
 *   Main Deck. Deal 1 to an enemy unit here for each card with [Hidden], then
 *   recycle them.
 *
 * ⚠ 数据问题（不改数据，仅报告）：本印刷文本是旧版。官方勘误（S-ORIGINS
 *   Teemo, Strategist）删除“played from [Hidden]”分支，并要求目标选择早于公开
 *   五张牌；`docs/plans/survey/data-issues-recheck.md`（ogn-121-298）与
 *   `docs/plans/survey/unclassified-ogn.md` 第 17 条记录了同一结论。程序按任务
 *   给定的 sourceText 逐字编写，不擅自采用勘误文本。
 *
 * 规则依据（CR v1.5）：
 * - [Hidden]（811）：卡牌声明 keyword；Hide 的费用与「从 Hidden 打出」许可由
 *   cost.hidden / continuous.timing 承担（keywords/Hidden.ts 只声明展开形状，
 *   RIFT-84/89/91 尚未落地）。
 * - “When I defend …”：防守触发（时点 defense-declared，383.4.f），filter 指自身
 *   且“here”限定在当前位置（421.1）。
 * - “reveal the top 5 cards of your Main Deck”：effect.reveal（425.1/425.3）。
 * - “Deal 1 to an enemy unit here for each card with [Hidden]”：effect.damage；
 *   数额为“被展示牌中带 [Hidden] 的张数”，伤害目标是一名此处敌方单位（355.7、
 *   418.1）。
 * - “then recycle them”：effect.recycle 回收被展示的牌（417.1.a、417.4）。
 *
 * status: judge-required —— 有依据的 IR 保留如下，但整卡尚不可执行：
 * 1. [Hidden] 展开与 played-from-Hidden 状态判定缺失（811.1.b、811.1.d.3）：
 *    cost.hidden（Hide 费用）、continuous.timing（次回合 [Reaction]）与
 *    「面向下打出的牌」的状态信息都没有已合入实现（依赖 RIFT-84/RIFT-89/RIFT-91）。
 * 2. “top 5 cards” 需要上游按真实牌库顺序提供 effect.reveal 的 pick。
 *    当前 zone/count 只能在全区域不超过 5 张时执行；真子集会明确阻断，
 *    不能把 ctx.query 的集合顺序当作牌库顺序。
 * 3. “for each card with [Hidden]” 需要「在被展示的子集合内按特征计数」的表达式；
 *    现有 count 只在整个查询集合上计数，尚无作用于链接子集合的计数形式。
 */
const teemoStrategist = {
  canonicalCardId: "card.hash-605d9e63c28576716347062f9abdcd9fe543138a4b9bee8f5308c24ffac2ae1e",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "1) [Hidden] 展开与“从 Hidden 打出”的状态判定缺失：cost.hidden（811.1.b Hide 费用）" +
    "与 continuous.timing（次回合 [Reaction]、811.1.d.3 面向下打出限制）都无已合入实现，" +
    "依赖 RIFT-84（kw-hidden）/RIFT-89（cost.hidden、费用与区域）/RIFT-91（continuous.timing）。" +
    "2) “reveal the top 5 cards of your Main Deck” 需要上游有序 pick 绑定：effect.reveal（RIFT-66）" +
    "已支持 pick 并拒绝按 ctx.query 顺序截取牌库真子集；当前 zone/count 仅在全区域不超过 5 张时可执行，" +
    "超过时明确阻断。需上游从 zoneSlice 提供真实顶 5 张并接入卡牌 IR，不用集合顺序近似。" +
    "3) “Deal 1 … for each card with [Hidden]” 需要“在被展示子集合内按特征计数”的表达式；" +
    "现有 count 只能在整个查询集合上计数，无作用于链接子集合的计数形式，effect.reveal 也只链接引用" +
    "（不产出该计数）。amount 因此读链接值 revealedHiddenCount（无生产者），结算时会按 MissingInformation " +
    "ignored，而不是把“张数”当伤害数额近似结算。" +
    "另：本印刷文本为旧版，官方勘误已删除 played-from-Hidden 分支并要求先选目标再翻牌" +
    "（docs/plans/survey/data-issues-recheck.md ogn-121-298）；不擅自改写数据。",
  abilities: [
    { kind: "keyword", keyword: "hidden" },
    {
      kind: "triggered",
      trigger: {
        at: "defense-declared",
        filter: { event: "defense-declared", filter: { source: "self", here: true } }
      },
      optional: false,
      body: [
        {
          id: "teemo.reveal",
          op: "effect.reveal",
          args: {
            zone: { kind: "constant", value: "deck" },
            count: { kind: "constant", value: 5 }
          }
        },
        {
          // “Deal 1 to an enemy unit here for each card with [Hidden]” — the amount
          // is the number of revealed cards that carry [Hidden]. No merged
          // primitive links that count (effect.reveal links only the refs), so the
          // amount reads the missing key from the reveal step: the merged
          // interpreter then reports MissingInformation and the instruction is
          // ignored instead of silently dealing the wrong amount.
          id: "teemo.damage",
          op: "effect.damage",
          linkedTo: "teemo.reveal",
          args: {
            amount: {
              kind: "linked-value",
              instructionId: "teemo.reveal",
              key: "revealedHiddenCount"
            },
            target: { kind: "constant", value: "teemo.enemy-unit-here" }
          },
          targets: [
            {
              id: "teemo.enemy-unit-here",
              filter: { type: "unit", controller: "opponent", sameLocationAs: "source" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          // “then recycle them” — the revealed cards are the referenced set
          // (359.3.e.14), so the instruction is linked to the reveal.
          id: "teemo.recycle",
          op: "effect.recycle",
          linkedTo: "teemo.reveal",
          args: {
            objects: { kind: "linked-value", instructionId: "teemo.reveal", key: "revealed" }
          }
        }
      ]
    },
    {
      // “or I'm played from [Hidden]” — a second trigger for the same effect.
      // `playedFrom: "hidden"` is the intended restriction (811.1.d.3); the
      // facedown-play state is not part of any merged trigger payload yet.
      kind: "triggered",
      trigger: {
        at: "card-played",
        filter: { event: "card-played", filter: { role: "self", playedFrom: "hidden" } }
      },
      optional: false,
      body: [
        {
          id: "teemo.hidden.reveal",
          op: "effect.reveal",
          args: {
            zone: { kind: "constant", value: "deck" },
            count: { kind: "constant", value: 5 }
          }
        },
        {
          // Same as the defend trigger: the count of revealed [Hidden] cards is
          // not produced by any merged primitive (see the trigger above).
          id: "teemo.hidden.damage",
          op: "effect.damage",
          linkedTo: "teemo.hidden.reveal",
          args: {
            amount: {
              kind: "linked-value",
              instructionId: "teemo.hidden.reveal",
              key: "revealedHiddenCount"
            },
            target: { kind: "constant", value: "teemo.hidden.enemy-unit-here" }
          },
          targets: [
            {
              id: "teemo.hidden.enemy-unit-here",
              filter: { type: "unit", controller: "opponent", sameLocationAs: "source" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          id: "teemo.hidden.recycle",
          op: "effect.recycle",
          linkedTo: "teemo.hidden.reveal",
          args: {
            objects: {
              kind: "linked-value",
              instructionId: "teemo.hidden.reveal",
              key: "revealed"
            }
          }
        }
      ]
    }
  ],
  sourceText:
    "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
    "When I defend or I'm played from [Hidden], reveal the top 5 cards of your Main Deck. " +
    "Deal 1 to an enemy unit here for each card with [Hidden], then recycle them."
} satisfies CardProgram;

export default teemoStrategist;

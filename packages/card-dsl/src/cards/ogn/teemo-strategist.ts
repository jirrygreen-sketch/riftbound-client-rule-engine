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
 * ⚠ 数据问题（不改数据，仅报告）：本程序保留的 sourceText 是旧版。官方勘误（S-ORIGINS
 *   Teemo, Strategist）删除“played from [Hidden]”分支，并要求目标选择早于公开
 *   五张牌；`docs/plans/survey/data-issues-recheck.md`（ogn-121-298）
 *   已记录 OGN 刷新目录使用新版结构。程序按任务
 *   给定的 sourceText 逐字编写，不擅自采用勘误文本。
 *
 * 规则依据（CR v1.5）：
 * - [Hidden]（811）：卡牌声明 keyword；Hide 的费用与「从 Hidden 打出」许可由
 *   Hidden 生命周期承担（keywords/Hidden.ts 已展开为 cost.hidden，
 *   但该静态效果尚无完整 Hide/facedown 消费方）。
 * - “When I defend …”：防守触发（时点 defense-declared，383.4.f），filter 指自身。
 *   “here”限制伤害目标所在位置（421.1），不是额外的防守触发条件。
 * - “reveal the top 5 cards of your Main Deck”：effect.reveal（425.1/425.3）。
 * - “Deal 1 to an enemy unit here for each card with [Hidden]”：effect.damage；
 *   数额为“被展示牌中带 [Hidden] 的张数”，伤害目标是一名此处敌方单位（355.7、
 *   418.1）。
 * - “then recycle them”：effect.recycle 回收被展示的牌（417.1.a、417.4）。
 *
 * Status: judge-required.
 * Preserve the supplied pre-errata sourceText; catalog correction is outside
 * this card's scope (docs/plans/survey/data-issues-recheck.md, ogn-121-298).
 * Hidden expansion and count over a linked revealed set are already merged.
 * Ordered top-five picks now use the merged Finalize/chain adapter, for both
 * printed trigger branches. Remaining gaps: Hide/facedown, playedFrom binding,
 * the defend-event producer, the target-location validator/adapter alignment,
 * and a Hidden keyword-membership predicate.
 * revealedHiddenCount remains an unproduced placeholder, never guessed damage.
 */
const teemoStrategist = {
  canonicalCardId: "card.hash-605d9e63c28576716347062f9abdcd9fe543138a4b9bee8f5308c24ffac2ae1e",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "Hidden 的 cost.hidden 仍缺 Hide/Facedown 生命周期、card-hidden 产生方和次回合 Reaction/忽略基础费用许可（811.1.b/811.6）；" +
    "playedFrom:hidden 也无受信事件绑定，defense-declared 时点仍缺 combat/turn 的真实事件产生方。" +
    "目标 here 仍缺校验/程序绑定对齐：translateObjectFilter 拒绝 sameLocationAs，已合入的 TargetSpec.location " +
    "source-location 虽有引擎消费方，却被 card-dsl validateTarget 当成 LocationFilter 拒绝；防守 filter 的 here 字段也被 self 匹配分支忽略。" +
    "count 虽能限定 revealed 链接集合，仍缺 Hidden 关键词成员筛选（811.5/811.5.a），" +
    "effect.reveal 不生成 revealedHiddenCount，不能猜测伤害。" +
    "本程序 sourceText 仍为勘误前文本；刷新目录审计记录新版删除 played-from-Hidden 分支并先选敌方目标（docs/plans/survey/data-issues-recheck.md " +
    "ogn-121-298），需父任务协调文本/身份与执行时序，本任务保持原文不变。不近似实现。",
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
            pick: { kind: "constant", value: "teemo.top-five" }
          },
          picks: [{
            id: "teemo.top-five", options: [], ordered: true, selection: "all",
            zoneSlice: { zone: "deck", from: "top", count: { kind: "constant", value: 5 } }
          }]
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
      // `playedFrom: "hidden"` is the intended restriction (811.1.d); the
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
            pick: { kind: "constant", value: "teemo.hidden.top-five" }
          },
          picks: [{
            id: "teemo.hidden.top-five", options: [], ordered: true, selection: "all",
            zoneSlice: { zone: "deck", from: "top", count: { kind: "constant", value: 5 } }
          }]
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

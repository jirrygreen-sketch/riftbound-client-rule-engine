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
 *   Hidden 生命周期承担（keywords/Hidden.ts 已展开为 cost.hidden，
 *   但该静态效果尚无完整 Hide/facedown 消费方）。
 * - “When I defend …”：防守触发（时点 defense-declared，383.4.f），filter 指自身
 *   且“here”限定在当前位置（421.1）。
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
 * Remaining gaps: Hide/facedown and playedFrom/here bindings, ordered top-five
 * pick finalization/adapter wiring, and a Hidden keyword-membership predicate.
 * revealedHiddenCount remains an unproduced placeholder, never guessed damage.
 */
const teemoStrategist = {
  canonicalCardId: "card.hash-605d9e63c28576716347062f9abdcd9fe543138a4b9bee8f5308c24ffac2ae1e",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "1) Hidden 展开与程序绑定已合入，但静态 cost.hidden 尚无完整 Hide 行动、Facedown Zone、card-hidden 产生方及 " +
    "811.1.b/811.6 次回合 Reaction/忽略基础费用的打出许可；playedFrom:hidden 也无受信事件状态消费。defense-declared 的 " +
    "here 与目标 sameLocationAs:source 缺战场相对绑定。2) effect.reveal 已支持有序 pick，zoneSlice 可读真实牌库顶；" +
    "仍缺将 top 5 的有序选择接入本卡 Finalize/原始 IR 与 chain 参数适配，zone/count 只能在整区不超过 5 张时执行，不能截取无序集合近似。" +
    "3) count 已能经 object.linked 查询被展示子集合，但缺按 Hidden 关键词成员筛选的消费方（811.5）；effect.reveal 不生成 " +
    "revealedHiddenCount，当前 amount 占位仍不能结算成真实伤害。另：数据审计记录此印刷文本为勘误前版本，勘误删除 played-from-Hidden " +
    "分支并要求先选目标再翻牌（docs/plans/survey/data-issues-recheck.md ogn-121-298）；本任务保持 sourceText 不变，" +
    "不近似实现。",
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

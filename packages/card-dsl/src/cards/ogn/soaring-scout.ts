import type { CardProgram } from "../../ir/index.js";

/**
 * Soaring Scout (ogn-216-298) — Unit, 2 energy, Might 1（无印刷 Power）。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ogn-216-298）：
 *   [Deathknell] — Channel 1 rune exhausted. (When I die, get the effect.)
 *
 * 规则依据（CR v1.5）：
 * - 808 Deathknell：触发式能力关键词，功能等于「When I die, [Effect]」（808.1.c）；触发点是
 *   自身被消灭并送入 Trash（808.1.d、429.1），对应封闭时点 object-killed；808.1.d.2/d.3 要求
 *   在置入 Trash 之前把触发入链并记录最后已知信息。
 * - 431.1/431.2/431.2.a：Channel 1 rune 从 Rune Deck 顶把 1 张符文放上场；「exhausted」是
 *   进入方式的规定（431.2 的官方例子正是 "Channel 1 rune exhausted"），默认就绪进入。
 * - 431.3：Rune Deck 不足时尽可能多，短少不构成失败。
 *
 * 结构：
 * - abilities[0] 声明 { kind: "keyword", keyword: "deathknell" }（契约 3.1 关键词能力、§5 只声明）；
 * - abilities[1] 展开 [Effect] 本体：object-killed 触发（最后已知信息由解释器处理），body 用
 *   已合入的 effect.channel 表达「Channel 1 rune exhausted」（amount 1、exhausted true，
 *   player 省略即 ctx.controller）。
 *
 * status = judge-required：
 * - Deathknell 的 KeywordDef（RIFT-82）展开体引用尚未注册的 trigger.leave 原语；
 * - effect.channel 把 exhausted: true 作为 channel-rune 动作的规定提交，但已合入的
 *   效果管线内核忽略该字段（符文仍以就绪状态进入符文区）。见 judgeReason。
 */
const soaringScout = {
  canonicalCardId: "card.hash-21546c63920e01becbf09de7c0589b5713c48f7a17e0539ecb8caad77b4e3c9e",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处缺口：(1) [Deathknell] 的关键词展开（effects/keywords/Deathknell.ts，RIFT-82）把触发体写成 " +
    "trigger.leave，而 effects/instructions/ 没有注册该原语，object-killed 触发入链与 808.1.d.1（死亡被替代时移出链）" +
    "仍未接线（RIFT-82 展开 + RIFT-120 事件管线）；(2)「Channel 1 rune exhausted」的进入规定（CR 431.2）没有落地——" +
    "effect.channel 会把 exhausted: true 作为 channel-rune 动作的 stipulation 提交，但已合入的效果管线内核忽略该字段" +
    "（符文仍以就绪状态进入符文区）。" +
    "依赖：trigger.leave / Deathknell 展开（RIFT-82 / RIFT-120）、以及 channel-rune 动作对 431.2 进入状态的支持。" +
    "不近似实现（不用「先 Channel 再横置」代替，那会多出一次状态改变事件）。",
  abilities: [
    { kind: "keyword", keyword: "deathknell" },
    {
      kind: "triggered",
      trigger: {
        at: "object-killed",
        filter: { event: "object-killed", filter: { role: "self" } }
      },
      optional: false,
      body: [
        {
          id: "soaring-scout.channel-1-exhausted",
          op: "effect.channel",
          args: {
            amount: { kind: "constant", value: 1 },
            exhausted: { kind: "constant", value: true }
          }
        }
      ]
    }
  ],
  sourceText:
    "[Deathknell] — Channel 1 rune exhausted. (When I die, get the effect.)"
} satisfies CardProgram;

export default soaringScout;

import type { CardProgram } from "../../ir/index.js";

/**
 * Darius, Trifarian (ogn-027-298) — Unit, Fury, Trifarian/Darius/Noxus/Champion.
 * energy 5, power 1 (Fury), Might 5.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, ogn-027-298):
 *   "When you play your second card in a turn, give me +2 :rb_might: this turn
 *    and ready me."
 *
 * 规则依据（CR v1.5）：
 * - 383.2/383.4："When you play your second card in a turn" 是按打出次数计数的
 *   触发条件；“your second card in a turn”需要对“本回合你已打出的牌”计数
 *   （HistoryQuery / condition.history），在进链前判断本次事件的序数
 *   （383.2.a.1、383.2.c）。下方 count 是待定描述，当前不会读取历史；
 *   需要包含本次 Finalize 的快照和回合重置，并计入 Darius 先前的打出。
 * - “give me +2 :rb_might: this turn” 是本回合到期（end-of-turn）的临时 Might
 *   修正：属于 continuous.might 持续效果；该原语已合入并通过 appliesTo
 *   注册来源自身的算术层效果。effect.buff 只处理 Buff 标记（702/703）。
 * - “and ready me” 用已合入的 effect.ready 原语（`objects` 省略即能力来源）；
 *   它不与前面的 Might 修正链接——“and”连接的是同一触发的两条独立指令，
 *   前一条被替代/否定不影响后一条（契约 3.4、359.3.e.14.b）。
 *
 * status：judge-required。continuous.might 与 effect.ready 已可执行；仍缺“本回合
 * 打出第二张牌”的历史计数条件；CardProgram 触发注册本身已有实现。
 */
const dariusTrifarian = {
  canonicalCardId: "card.hash-d60be23b23f087174848368190675a57a5a2f0d7dee4d43b85af49e18d0e2d31",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺 continuous.might/effect.ready 触发进链前的第二张牌序数条件（CR 383.2.a.1/383.2.c）：" +
    "condition.history 与 HistoryQuery 已可查询动作，但普通 count 忽略 cards-finalized-this-turn 的历史含义，TriggerSpec.condition 没有历史表达式适配。" +
    "还需本回合 Finalize 记录、包含本次事件的计数快照及回合重置；不能用已结算次数代替，也不能排除 Darius 自己先前作为本回合第一张牌的记录。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "card-played",
        filter: { event: "card-played", filter: { player: "controller" } },
        condition: {
          kind: "compare",
          left: {
            kind: "count",
            subject: "cards-finalized-this-turn",
            filter: { player: "controller", exclude: "self" }
          },
          operator: "eq",
          right: { kind: "constant", value: 1 }
        }
      },
      optional: false,
      body: [
        {
          id: "darius-trifarian.might-2",
          op: "continuous.might",
          args: {
            amount: { kind: "constant", value: 2 },
            duration: { kind: "constant", value: "end-of-turn" },
            appliesTo: { kind: "constant", value: "self" }
          }
        },
        {
          id: "darius-trifarian.ready",
          op: "effect.ready",
          args: {}
        }
      ]
    }
  ],
  sourceText:
    "When you play your second card in a turn, give me +2 :rb_might: this turn and ready me."
} satisfies CardProgram;

export default dariusTrifarian;

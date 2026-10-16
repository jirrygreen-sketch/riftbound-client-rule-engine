import type { CardProgram } from "../../ir/index.js";

/**
 * Thousand-Tailed Watcher (ogn-116-298) — Unit, 7 energy + 1 Mind power, Might 7，
 * 标签 Ionia。
 *
 * 原文：[Accelerate] (You may pay :rb_energy_1::rb_rune_mind: as an additional
 *      cost to have me enter ready.)
 *      When you play me, give enemy units -3 :rb_might: this turn, to a minimum
 *      of 1 :rb_might:.
 *
 * 规则依据（CR v1.5）：
 * - [Accelerate]：805 的可选附加费用关键词；卡片只声明 keyword（契约 3.1/3.7），
 *   展开由 effects/keywords/Accelerate.ts 负责。
 * - "When you play me"：383.4.a 的 Play Effect（打出触发），时点 card-played。
 * - "give enemy units -3 [M] this turn"：临时 Might 修正（本回合到期），属于
 *   continuous.might 与图层运算；"enemy units" 是集合查询（355.10.d：按特征而非
 *   玩家选择），不是 targets。
 * - "to a minimum of 1 [M]"：下限钳制，见 judgeReason。
 *
 * 状态：judge-required。触发句与“敌方单位”集合都能表达，但临时 Might 修正不能执行：
 * - 契约 3.6 的封闭 GameAction 集合没有 Might 修改动作；effect.buff 文档明确
 *   "temporary Might changes belong to continuous.might, never to this primitive"
 *   （Buff counter 是 702–705，+1 Might 且同一单位只能有一个，与 -3 不是一回事）。
 * - 图层消费者（RIFT-91 layers-continuous）与「本回合结束时到期」的持续期限
 *   （continuous.duration）都未合入，"to a minimum of 1" 的钳制也没有实现路径。
 * 按红线不做近似实现（不得改用 Buff counter 或手改 Might）。
 *
 * 依赖：RIFT-91（layers-continuous：continuous.might + continuous.duration）、
 * RIFT-89（Accelerate 的 cost.additional / cost.pay）。
 */
const thousandTailedWatcher = {
  canonicalCardId: "card.hash-0c45b29063c3531b9891e06fa06538c7ff50e7ecd9a1f6f1147e18ee33176c81",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「give enemy units -3 :rb_might: this turn, to a minimum of 1 :rb_might:」需要 continuous.might 图层减法" +
    "（契约 3.6 封闭 GameAction 无 Might 修改动作；effect.buff 是 702–705 的 Buff counter，不能替代 -3 Might）" +
    "以及本回合到期（continuous.duration）与「最低 1」钳制；layers/continuous 消费者（RIFT-91）未合入。" +
    "[Accelerate] 展开（cost.additional / cost.pay + 入场就绪替代）依赖 RIFT-89 与入场替代管线。不近似实现。" +
    "依赖：RIFT-91、RIFT-89。",
  abilities: [
    { kind: "keyword", keyword: "accelerate" },
    {
      kind: "triggered",
      trigger: {
        at: "card-played",
        filter: { event: "card-played", filter: { role: "self" } }
      },
      optional: false,
      body: [
        {
          id: "watcher.debuff-enemy-units",
          op: "continuous.might",
          args: {
            amount: { kind: "constant", value: -3 },
            duration: { kind: "constant", value: "this-turn" },
            minimum: { kind: "constant", value: 1 },
            // 355.10.d："enemy units" 是按特征选择的一组（无玩家选择），用集合查询表达。
            objects: {
              kind: "constant",
              value: {
                kind: "query",
                filter: { zone: "board", type: "unit", controller: "opponent" }
              }
            }
          }
        }
      ]
    }
  ],
  sourceText:
    "[Accelerate] (You may pay :rb_energy_1::rb_rune_mind: as an additional cost to have me enter ready.)\n" +
    "When you play me, give enemy units -3 :rb_might: this turn, to a minimum of 1 :rb_might:."
} satisfies CardProgram;

export default thousandTailedWatcher;

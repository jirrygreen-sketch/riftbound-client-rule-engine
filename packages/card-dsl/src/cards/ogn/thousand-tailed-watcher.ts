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
 * 状态：judge-required。debuff 本体已可执行：已合入的 continuous.might 支持
 * 集合查询（objects: { kind: "query", filter }）、本回合到期（duration "this-turn"
 * → end-of-turn）与印刷下限（minimum 1，CR 478.1.c 的逐步钳制由 layers/ops 的
 * applyMightMinimums 消费），golden 用真实解释器 + 图层引擎执行并断言 -3 与
 * 下限 1、回合末到期。effect.buff 仍是 702–705 的 Buff counter，不能替代本修正。
 * 仍缺、不近似实现：
 * - 触发侧没有 CardProgram → TriggerRegistration 的订阅方（RIFT-257 进行中）：
 *   "When you play me" 目前无法从 card-played 时点进入链；触发 filter 的自身锚点
 *   写法（filter: { role: "self" }）也只有 RIFT-257 的 translateTriggerFilter 会归一化，
 *   已合入的 events/pipeline-match.ts 会把它当作无过滤条件而过度匹配。
 * - [Accelerate]（805）只声明 keyword：没有任何已合入消费方调用
 *   effects/keywords/Accelerate.ts 的展开（accelerate.cost 静态效果 +
 *   805.6 的入场就绪替代），可选附加费用的收取属 RIFT-261。
 *
 * 依赖：RIFT-257（卡牌触发/关键词展开的生产绑定）、RIFT-261（Accelerate 的
 * cost.additional / cost.pay 与 805.6 入场替代消费）。
 */
const thousandTailedWatcher = {
  canonicalCardId: "card.hash-0c45b29063c3531b9891e06fa06538c7ff50e7ecd9a1f6f1147e18ee33176c81",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "debuff 本体已可执行：continuous.might 已合入，可用 objects 的集合查询（355.10.d 的「enemy units」不是目标）、" +
    "duration \"this-turn\"（end-of-turn 到期）与 minimum 1（CR 478.1.c 的印刷下限）注册 -3 Might；" +
    "golden 用真实解释器 + 图层引擎执行并断言 -3、最低 1 与回合末到期。effect.buff 是 702–705 的 Buff counter，不用于本修正。" +
    "整卡仍不可执行：" +
    "① 触发侧没有已合入订阅方把 CardProgram 的 triggered ability 注册成 TriggerRegistration（RIFT-257 进行中），" +
    "card-played 的「When you play me」无法进链；触发 filter 的自身锚点写法（filter: { role: \"self\" }）也依赖 RIFT-257 的 " +
    "translateTriggerFilter 归一化，已合入的 events/pipeline-match.ts 会忽略该嵌套键而过度匹配；" +
    "② [Accelerate]（805）只声明 keyword：没有任何已合入消费方调用 effects/keywords/Accelerate.ts 的展开" +
    "（accelerate.cost 静态效果与 805.6 的入场就绪替代），可选附加费用的收取属 RIFT-261。" +
    "依赖：RIFT-257（卡牌触发绑定与关键词展开消费）、RIFT-261（Accelerate 的费用与入场替代消费）。不近似实现。",
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

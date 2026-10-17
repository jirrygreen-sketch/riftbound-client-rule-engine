import type { CardProgram } from "../../ir/index.js";

/**
 * Stormclaw Ursine (ogn-137-298) — Unit, 7 energy, no printed power (Body), 6 Might.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, ogn-137-298):
 *   [Tank] (I must be assigned combat damage first.)
 *   When you play me, channel 1 rune exhausted.
 *
 * 规则依据（CR v1.5）：
 * - [Tank]（815）：815.1 Passive Ability keyword；815.1.b 功能上等于“同一控制者的
 *   其他无 Tank 单位之前，我必须先被分配致命伤害”；815.2 多重实例冗余。
 *   本卡按契约 3.7 只声明关键词，展开（continuous.combat 的伤害分配约束）由
 *   effects/keywords/ 的 Tank.ts 与 programs/keywords.ts 负责，均已合入。
 * - “When you play me”：打出触发（时点 card-played，filter 指向自身）。
 * - “channel 1 rune exhausted”：effect.channel（431.1 channel 取符文牌库顶；431.2
 *   允许规定入场状态，`exhausted: true`）。
 *
 * Status: judge-required.
 * The Tank expansion and card-played/channel body are available, but the two
 * rule consumers that would make the whole card executable are still missing:
 * combat allocation does not consume Tank's first/lethal assignment priority
 * (815.1.b/815.1.c), and the reference channel-rune action ignores the
 * exhausted entry-state stipulation (431.2).
 */
export default {
  canonicalCardId: "card.hash-c18b4d77a6fdbfcd9607beb0b7cb54e7133f47d1442f38f5e6dc0c7c5b88a769",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "[Tank] 的关键词展开与静态注册已可用，但 continuous.combat 的 damage-assignment/priority first " +
    "尚无战斗消费方：combat/base-combat-allocation.ts 只接受 keywordPriority=proven-none 的基础分配证明，" +
    "不能执行 CR 815.1.b/815.1.c 的先分配致命伤害约束。card-played 触发过滤绑定、解释器链路与 " +
    "effect.channel 已有真实执行证据；但 effects/testing/test-kernel.ts 的 channel-rune 仍忽略 exhausted，" +
    "CR 431.2 的横置入场状态尚未真正落地。仍缺 Tank 战斗分配优先级与 channel-rune exhausted 入场状态，" +
    "不近似实现。",
  abilities: [
    { kind: "keyword", keyword: "tank" },
    {
      kind: "triggered",
      trigger: {
        at: "card-played",
        filter: { event: "card-played", filter: { source: "self" } }
      },
      optional: false,
      body: [
        {
          id: "stormclaw.channel",
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
    "[Tank] (I must be assigned combat damage first.)\n" +
    "When you play me, channel 1 rune exhausted."
} satisfies CardProgram;

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
 * Tank expands and registers as continuous.combat; combat allocation still
 * does not consume its first/lethal assignment priority (815.1.b/815.1.c).
 * The authored body submits exhausted channeling; the reference kernel ignores
 * the exhausted flag, leaving CR 431.2 entry-state execution unproven.
 */
export default {
  canonicalCardId: "card.hash-c18b4d77a6fdbfcd9607beb0b7cb54e7133f47d1442f38f5e6dc0c7c5b88a769",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "[Tank] 的关键词展开与程序静态注册已合入（effects/keywords/Tank.ts、programs/statics.ts），但 " +
    "continuous.combat 的 damage-assignment/priority first 尚无战斗消费方：" +
    "combat/base-combat-allocation.ts 只允许已证明没有分配优先级要求的基础分配，不能执行 815.1.b/815.1.c 的先分配致命伤害约束。" +
    "card-played 程序触发绑定和 effect.channel 已合入，原始 body 会提交 exhausted:true 并从符文牌库移出 1 张；但 " +
    "effects/testing/test-kernel.ts 的 channel-rune 忽略 exhausted，431.2 的横置入场状态尚未执行正确。仍缺 Tank " +
    "战斗分配优先级与 channel-rune 入场状态落实，不近似实现。",
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

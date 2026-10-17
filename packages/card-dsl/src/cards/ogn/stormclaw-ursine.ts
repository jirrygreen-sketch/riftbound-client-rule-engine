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
 *   effects/keywords/ 负责 —— 当前 keywords/ 下没有 Tank.ts。
 * - “When you play me”：打出触发（时点 card-played，filter 指向自身）。
 * - “channel 1 rune exhausted”：effect.channel（431.1 channel 取符文牌库顶；431.2
 *   允许规定入场状态，`exhausted: true`）。
 *
 * status: judge-required —— [Tank] 的展开已合入（keywords/Tank.ts，RIFT-264）但没有消费方：
 * 1. 展开结果是 continuous.combat 的 damage-assignment/priority "first" 声明，
 *    layers/engine.ts 的层分支不命中该 kind（layers/ops/index.ts 只把它持久化为注册行）。
 * 2. 战斗伤害分配仍不读取指派优先级：combat/base-combat-allocation.ts 明确注释
 *    "No Tank/Backline/other assignment-priority requirement is bound here"，815.1.b/815.1.c 不可执行。
 * channel 半段仅用已合入的 effect.channel（431.1/431.2），golden 测试以真实原语执行该半段。
 * 依赖：continuous.combat 的战斗消费方 + 伤害分配优先级绑定（引擎战斗流程）。
 */
export default {
  canonicalCardId: "card.hash-c18b4d77a6fdbfcd9607beb0b7cb54e7133f47d1442f38f5e6dc0c7c5b88a769",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "[Tank] 的 KeywordDef 已合入（effects/keywords/Tank.ts，RIFT-264），展开为 single-stacking 的静态 " +
    "continuous.combat（mode damage-assignment、priority first、excludesKeyword Tank），但没有消费方：" +
    "layers/engine.ts 不命中该 kind，战斗伤害分配也不读取指派优先级" +
    "（combat/base-combat-allocation.ts 注释未绑定任何 assignment-priority），815.1.b/815.1.c 的战术顺序不可执行。" +
    "channel 半段用已合入的 effect.channel（431.1/431.2）并有执行测试；整卡仍需 Tank 的真实战斗消费方，故保持 judge-required。" +
    "依赖：continuous.combat 消费方与战斗伤害分配顺序（引擎战斗流程）。不近似实现。",
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

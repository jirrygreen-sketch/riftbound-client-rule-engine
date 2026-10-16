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
 * status: judge-required —— 缺 Tank 的关键词展开与消费方：
 * 1. effects/keywords/ 没有 Tank.ts，815.1.b 的伤害分配强制没有被任何已合入模块消费
 *    （combat/base-combat-allocation.ts 明确注释不绑定 Tank 的分配优先级）。
 * 2. 关键词展开依赖关键词批次（kw-tank），伤害分配约束属引擎批 5 战斗流程。
 * channel 半段仅用已合入的 effect.channel，golden 测试以真实原语执行该半段。
 */
export default {
  canonicalCardId: "card.hash-c18b4d77a6fdbfcd9607beb0b7cb54e7133f47d1442f38f5e6dc0c7c5b88a769",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺 [Tank] 的关键词展开与消费方：effects/keywords/ 下没有 Tank.ts（契约 3.7 要求每个关键词一个文件），" +
    "combat/base-combat-allocation.ts 明确不绑定 Tank 的伤害分配约束，815.1.b 的强制顺序没有已合入实现；" +
    "依赖关键词批次 kw-tank 与战斗流程（引擎批 5）。channel 半段用已合入的 effect.channel（431.1/431.2），" +
    "但整卡仍需 Tank 展开才算可执行，故不标 executable。",
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

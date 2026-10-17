import type { CardProgram } from "../../ir/index.js";

/**
 * Lecturing Yordle (ogn-087-298), CR v1.5 815.1.b / 815.1.c.2 / 383.4.a.2 / 414.
 * 当前复核：打出本卡的订阅与 Draw 1 已有真实链执行证据；唯一剩余缺口是
 * Tank 的战斗分配消费方。continuous.combat 注册不等于执行先分配致命伤害。
 */
export default {
  canonicalCardId: "card.hash-d5bee8c48f53404d08ff88d8472305114b39bc2f137cfb3e59c46e99340d0119",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺 Tank 的 combat 分配消费方：关键词展开的 continuous.combat 可注册到 ability 层，" +
    "但尚无分配流程消费 damage-assignment/priority=first/lethal；基础分配接口仅接受 keywordPriority=proven-none。" +
    "须先向同控制者的 Tank 单位分配致命伤害，再允许给非 Tank 单位分配（815.1.b/815.1.c.2）。",
  abilities: [
    { kind: "keyword", keyword: "tank" },
    {
      kind: "triggered",
      trigger: {
        at: "card-played",
        filter: { event: "card-played", filter: { role: "self" } }
      },
      optional: false,
      body: [
        {
          id: "lecturing-yordle.draw-1",
          op: "effect.draw",
          args: { amount: { kind: "constant", value: 1 } }
        }
      ]
    }
  ],
  sourceText: "[Tank] (I must be assigned combat damage first.)\nWhen you play me, draw 1."
} satisfies CardProgram;

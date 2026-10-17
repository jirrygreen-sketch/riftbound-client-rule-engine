import type { CardProgram } from "../../ir/index.js";

/** CR v1.5 054.1、134、418、426。注册静态限制不等于 counter 已执行该限制。 */
export default {
  canonicalCardId: "card.hash-04c50ac19d094543330b995ad389879feae4cb9a688c51fa00317e7c72c11ae0",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "仍缺 054.1/426 的不可被反击限制消费：continuous.restrict 已有注册与查询，但 ChainEngine 的 counter 路径尚未查询本牌的 cannot-be-countered。134 的 Calm 领域还缺独立领域特征与成员谓词（RIFT-359）；ObjectSnapshot.power 是力量费用域，不能漏掉 power:null 的 Calm 单位。",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      // 054.1：静态限制可注册；counter 动作仍需消费此禁止。
      kind: "static",
      effect: {
        kind: "continuous.restrict",
        restriction: "cannot-be-countered",
        actions: ["counter"],
        appliesTo: "self"
      }
    },
    {
      kind: "play",
      // 印刷基础费用：1 能量 + 1 点 Fury 力量。
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 1 },
        power: { kind: "constant", value: 1 }
      },
      body: [
        {
          // 「Deal 4 to an enemy Calm unit」：4 点非战斗伤害（418.1.c），来源缺省为法术本身（418.6.a）。
          id: "decree-of-rage.deal-4",
          op: "effect.damage",
          args: {
            amount: { kind: "constant", value: 4 },
            target: { kind: "constant", value: "decree-of-rage.enemy-calm-unit" }
          },
          targets: [
            {
              id: "decree-of-rage.enemy-calm-unit",
              // controller: "opponent" 是已合入的玩家选择器；characteristics.domains 是待接线的
              // 领域谓词占位（见 judgeReason 第 2 条），合并匹配器不识别该键，故不会误伤。
              filter: {
                type: "unit",
                zone: "board",
                controller: "opponent",
                characteristics: { domains: ["Calm"] }
              },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ],
  sourceText:
    "[Action] (Play on your turn or in showdowns.)\n" +
    "This can't be countered.\n" +
    "Deal 4 to an enemy Calm (:rb_rune_calm:) unit."
} satisfies CardProgram;

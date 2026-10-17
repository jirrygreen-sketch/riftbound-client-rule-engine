import type { CardProgram } from "../../ir/index.js";

/**
 * Viktor, Innovator — CR v1.5 383.2.a.1, 187.1, 185.2.a, 440.2.c.
 * Trigger registration and token Expr dispatch are merged. Resolve the ability
 * controller's base through condition.value before playing the Recruit there.
 * Trigger-time turn ownership remains blocked (RIFT-359).
 */
const viktorInnovator = {
  canonicalCardId: "card.hash-27a69aef36a430f79f170618dfa72e36b2605b39fa8a3a67366ac01669844aa0",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「on an opponent's turn」需要 CR 383.2.a.1 的触发时回合归属谓词；Condition/Expr 目前不能读取事件的 activePlayerId，常数字符串占位不构成语义（条件谓词 RIFT-359）。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "card-played",
        filter: {
          event: "card-played",
          player: "controller"
        },
        // 「on an opponent's turn」需要在触发时比较回合玩家与控制者；冻结 IR 无处
        // 表达该谓词（见 judgeReason），保留原文含义的占位形状。
        condition: {
          kind: "expression",
          value: { kind: "constant", value: "active-player-is-opponent-of-controller" }
        }
      },
      optional: false,
      body: [
        {
          id: "viktor.controller-base",
          op: "condition.value",
          args: {
            value: { kind: "location", value: { type: "base", player: "controller" } },
            key: { kind: "constant", value: "base" }
          }
        },
        {
          id: "viktor.play-recruit",
          op: "effect.token",
          args: {
            // 187.1：1 Might 的 Recruit 单位 token。
            token: { kind: "constant", value: "recruit" },
            amount: { kind: "constant", value: 1 },
            // 440.2.c / 185.2.a："play" 先在链上生成，再由 play 接手打出。
            mode: { kind: "constant", value: "play" },
            // "in your base"：读取前序表达式解析出的能力控制者基地。
            location: {
              kind: "linked-value",
              instructionId: "viktor.controller-base",
              key: "base"
            },
            linkKey: { kind: "constant", value: "recruitToken" }
          }
        }
      ]
    }
  ],
  sourceText:
    "When you play a card on an opponent's turn, play a 1 :rb_might: Recruit unit token in your base."
} satisfies CardProgram;

export default viktorInnovator;

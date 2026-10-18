import type { CardProgram } from "../../ir/index.js";

/**
 * Viktor, Innovator — CR v1.5 383.2.a.1, 187.1, 185.2.a, 440.2.c.
 * 复核 2026-10-17：token 半段已有真实执行证据；「on an opponent's turn」仍缺
 * 可在 Condition/Expr 里读取事件回合归属的谓词，占位常量恒真会过度触发。
 */
const viktorInnovator = {
  canonicalCardId: "card.hash-27a69aef36a430f79f170618dfa72e36b2605b39fa8a3a67366ac01669844aa0",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「on an opponent's turn」仍缺触发时回合归属谓词（2026-10-17 复核，CR 383.2.a.1）：" +
    "条件里保留的表达式只是常量占位，evaluateCondition 对 expression 取 Boolean(常量) 恒真，" +
    "实测把本卡放到控制者自己的回合、以 card-played 触发，生产注册后照样追加了 1 个触发链项。" +
    "事件本身携带 activePlayerId（events/pipeline.ts 构造的 PipelineEvent 有该字段），" +
    "但 Condition/Expr 没有读取它的成员，也没有与之比较的相对回合归属谓词；" +
    "已合入的 predicate 只覆盖 played-from-hand / played-from-zone / event-printed / result，均不涉及回合归属。" +
    "没有该谓词就不能声称整卡可执行；不从常量占位近似放行。" +
    "已合入并有执行证据：触发注册接线、condition.value 解析能力控制者基地，以及 effect.token 的 play 模式" +
    "（先在链上生成再打入基地，token 无印刷费用、1 Might）。",
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

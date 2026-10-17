import type { CardProgram } from "../../ir/index.js";

/**
 * Viktor, Innovator — CR v1.5 383.2.a.1, 187.1, 185.2.a, 440.2.c.
 * Trigger registration and token Expr dispatch are merged. The remaining gaps
 * are trigger-time turn ownership (RIFT-359) and token-side consumption of the
 * merged controller-base LocationSelector (RIFT-357). mode:play already hands
 * the newly created Chain token to play.
 */
const viktorInnovator = {
  canonicalCardId: "card.hash-27a69aef36a430f79f170618dfa72e36b2605b39fa8a3a67366ac01669844aa0",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「on an opponent's turn」需要 CR 383.2.a.1 的触发时回合归属谓词；Condition/Expr 目前不能读取事件的 activePlayerId，常数字符串占位不构成语义（条件谓词 RIFT-359）。" +
    "「in your base」还需要 token 侧消费 RIFT-357 已合入的 LocationSelector 绑定：resolveLocationSelector 目前仅在 effect.move 解释边界被消费，effect.token 的 location 只接受常量 LocationRef，会把 {type:base,player:controller} 占位判为非法。" +
    "CardProgram 触发注册和 player:controller→self 归一化已合入，resolveChainBody 也已适配 effect.token 的 Expr schema；mode:play 自行创建 Chain token 并交给 play，不应再追加第二次 effect.play。整卡等待回合谓词与基地绑定。",
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
          id: "viktor.play-recruit",
          op: "effect.token",
          args: {
            // 187.1：1 Might 的 Recruit 单位 token。
            token: { kind: "constant", value: "recruit" },
            amount: { kind: "constant", value: 1 },
            // 440.2.c / 185.2.a："play" 先在链上生成，再由 play 接手打出。
            mode: { kind: "constant", value: "play" },
            // "in your base"：打出者的基地。
            location: {
              kind: "constant",
              value: { type: "base", player: "controller" }
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

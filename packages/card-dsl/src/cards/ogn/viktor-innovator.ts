import type { CardProgram } from "../../ir/index.js";

/**
 * Viktor, Innovator (ogn-117-298) — Unit, 4 energy + 1 Mind power, Might 3，
 * 标签 Viktor / Zaun / Champion。
 *
 * 原文：When you play a card on an opponent's turn, play a 1 :rb_might: Recruit
 *      unit token in your base.
 *
 * 规则依据（CR v1.5）：
 * - "When you play a card on an opponent's turn"：打出牌事件的触发；
 *   383.1.a 说明识别句不必在句首；触发时点 card-played（420.4.a：打出动作完成
 *   后触发）。"on an opponent's turn" 是触发条件的一部分（"当…时"之后的条件
 *   从句，383.2.a.1 属于触发条件），不是结算时的例外。
 * - 触发者："you" 指本能力控制者 → 事件载荷的 player 必须是 controller。
 *   当前时点载荷带有 activePlayerId / player（events/pipeline.ts 把
 *   emission.player 透传），但 TriggerSpec 的 ObjectFilter/EventPattern 里没有
 *   “事件发生时的回合玩家不是控制者”这一谓词（只有 controller/owner 选择符）。
 * - "play a 1 [M] Recruit unit token in your base"：440.2.c / 185.2.a 规定被
 *   “played”的 token 先在链上生成再由 play 动作接手；187.1 的 Recruit 单位 token
 *   为 1 Might。effect.token 的 mode "play" 走 create-token(to: chain) + play，
 *   已合入并可用（见 golden）。
 *
 * 状态：judge-required。token 打出链路本身已能真实执行（下方 golden 用真实原语
 * 跑通「链上生成 → play 到基地」），受阻的是触发条件本身：
 * - “on an opponent's turn” 需要在触发时比较事件发生的回合玩家与能力控制者；
 *   冻结的 TriggerSpec 只有 at / filter / condition / once，filter 里的
 *   ObjectFilter/EventPattern 只暴露 object/source/target 的 controller/owner
 *   选择符，没有“当前回合玩家”谓词，condition 的 Expr 也没有回合玩家读数
 *   （history 计数按 action/timingPoint/player 过滤，不区分为谁的回合）。
 *   调研 ability-templates.md 把这条能力单列为 continuous.timing 的
 *   "opponent's turn"（0/2 命中，阻断 1）——属 RIFT-91 的时机许可族。
 * - 因此本卡不得声称整卡可执行；token 部分的执行证据只证明局部原语正确。
 *
 * 依赖：RIFT-91（continuous.timing / 回合归属谓词）。
 */
const viktorInnovator = {
  canonicalCardId: "card.hash-27a69aef36a430f79f170618dfa72e36b2605b39fa8a3a67366ac01669844aa0",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「on an opponent's turn」这个触发条件无法判定：冻结的 TriggerSpec 只有 at / filter / condition / once，" +
    "ObjectFilter/EventPattern 只支持 object/source/target 的 controller/owner 选择符，没有「事件发生时的回合玩家不是" +
    "能力控制者」谓词；history 计数也只按 action / timingPoint / player 过滤，不区分回合归属。" +
    "调研 ability-templates.md 把该能力归入 continuous.timing 的 opponent's turn（阻断 1）。" +
    "token 部分（440.2.c / 185.2.a / 187.1 Recruit）已能真实执行，但不构成整卡可执行。依赖：RIFT-91。",
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
        },
        {
          id: "viktor.finish-recruit",
          op: "effect.play",
          linkedTo: "viktor.play-recruit",
          args: {
            object: {
              kind: "linked-value",
              instructionId: "viktor.play-recruit",
              key: "recruitToken.objects"
            },
            location: {
              kind: "constant",
              value: { type: "base", player: "controller" }
            }
          }
        }
      ]
    }
  ],
  sourceText:
    "When you play a card on an opponent's turn, play a 1 :rb_might: Recruit unit token in your base."
} satisfies CardProgram;

export default viktorInnovator;

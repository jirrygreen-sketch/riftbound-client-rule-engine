import type { CardProgram } from "../../ir/index.js";

/**
 * Insightful Investigator (unl-135-219) — Unit, Chaos, tag Piltover。
 * catalog：energy 3、power null（无印刷力量）、might 3。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-135-219，逐字）：
 *   When you play me, choose an opponent. They reveal their hand. You may pay 2
 *   XP to choose a card from their hand. If you do, they discard that card and
 *   draw 1.
 *
 * 规则依据（CR v1.5）——CR 204.3/204.3.a 与 383.3.b 都直接引用本卡作为例子：
 * - “When you play me” 是 Play Effect（383.4.a.1/383.4.a.2），时点 card-played。
 * - “choose an opponent”：玩家选择（355.7：指名 Player）。契约 3.6 的 targets() 只返回
 *   ObjectRef[]，没有玩家目标形状；PickSpec.options 是静态值数组，IR 无法静态列出对局中的
 *   PlayerId（缺 target.player 原语，同 mindsplitter / suave-negotiator 的记录）。
 * - “They reveal their hand”：425.1/425.3.a（未指明张数时展示该区域当前全部牌）、
 *   425.2（Reveal 是 Limited Action）。effect.reveal 已合入，player 接被选中的 PlayerId。
 * - “You may pay 2 XP to choose a card from their hand”：383.3.b 明确这段 “pay 2 XP” 是
 *   Cost within Instructions，但**不在效果的第一步**，因此不是触发能力的基础费用，而是在结算时
 *   支付（383.3.b.1 的 Finalize 基础费用不适用）。契约 3.9 的“可以……”写成 choice.optional，
 *   把被选指令包进 body（不用 choice + linkedTo）。被选的牌位于手牌（355.10.a：非公开区域
 *   里的对象不是目标），因此是非目标 pick；423.1.a 规定弃牌由执行者选择。
 * - “If you do, they discard that card and draw 1”：359.3.e.14 的 “If you do” 从句以“可选部分是否
 *   被执行”为准，因此付费、选牌弃牌、抽牌全部位于 choice.optional 的 body 内——拒绝时整组指令
 *   都不执行（契约 3.9 的“可以……”形状）。body 内 cost.pay → effect.discard 用 linkedTo 表达
 *   383.3.b 的 Cost within Instructions 与其 Effect（“pay 2 XP to choose a card”）；
 *   “discard that card and draw 1” 是同一从句里的两个独立动作（359.3.e.14.c），互不链接。两者
 *   都由该对手执行（effect.discard / effect.draw 的 player = 本程序链接的对手，190.6.d）。
 *
 * status = judge-required（缺口不近似实现）：
 * - 「choose an opponent」没有已合入的玩家选择原语（target.player），选项集合只能由 Finalize
 *   按当前对手解析；ChoiceRequest 也没有“选择玩家”的请求类型（只有 optional/mode/
 *   select-objects/order/number）。
 * - 「pay 2 XP」需要结算时按玩家决定支付 2 XP，并让“付费 + 选牌弃牌 + 抽牌”作为一个可选整体
 *   被执行：合并
 *   费用管线（cost/payment.ts）只能在 Finalize 收取已锁定的费用计划（payCostPlan 要求
 *   plan.finalized），没有“结算时按玩家决定支付 XP 并公开回执”的指令原语（见最终回复的契约
 *   变更请求）。
 * - 因此本卡在“对手选择 → 揭示 → 可选付费 → 弃牌/抽牌”这条完整序列上不可执行；已合入且被
 *   golden 真实执行的是三段子效果：effect.reveal（对手手牌）、effect.discard（pick 该手牌
 *   并按链式链接）、effect.draw（1 张），并以链接值绑定被选对手（测试内核按生产路径 provision）。
 *
 * 依赖：RIFT-9 / 父任务（target.player 玩家选择原语）、RIFT-89（结算时付费指令原语与回执）。
 */
export default {
  canonicalCardId:
    "card.hash-c9dc0b3daad63f09feabdf740bc69b2b327719079fe5d68568f0f4680d45abd2",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处依赖未合入：(1) 「choose an opponent」是玩家选择（355.7：指名 Player），但契约 3.6 的 targets() " +
    "只返回 ObjectRef[]、PickSpec.options 是静态值数组，IR 无法静态列出对局中的 PlayerId，ChoiceRequest 也没有" +
    "选择玩家的请求类型（只有 optional/mode/select-objects/order/number），缺 target.player 原语（同 mindsplitter / " +
    "suave-negotiator 的记录）。(2) 「You may pay 2 XP to choose a card from their hand」是 CR 383.3.b / 204.3.a 的" +
    "结算时 Cost within Instructions（CR 明确本卡不是基础费用），需要「按玩家决定支付 2 XP 并公开是否支付成功」的指令原语与" +
    "供 “If you do” 从句读取的回执；合并费用管线只能在 Finalize 收取已锁定的费用计划（payCostPlan 要求 plan.finalized）。" +
    "已合入且由 golden 真实执行的是三段子效果：effect.reveal（425.1/425.3.a 展示对手整手牌）、由该对手执行的 effect.discard" +
    "（pick 选牌，423.1.a）与 effect.draw（1 张），以及 359.3.e.14 的链式忽略。依赖：target.player 原语（RIFT-9/父任务）" +
    "与结算时付费指令（RIFT-89）。不近似实现。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "card-played",
        filter: { event: "card-played", filter: { source: "self" } }
      },
      optional: false,
      body: [
        {
          id: "insightful-investigator.choose-opponent",
          // 「choose an opponent」：玩家选择；target.player 未在 effects/instructions/ 实现
          // （见 judgeReason），链接值形状沿用已合入示例的键名。
          op: "target.player",
          args: {
            selection: { kind: "constant", value: "one" },
            chooser: { kind: "constant", value: "controller" },
            linkKey: { kind: "constant", value: "chosenOpponent" }
          }
        },
        {
          id: "insightful-investigator.reveal-hand",
          linkedTo: "insightful-investigator.choose-opponent",
          op: "effect.reveal",
          args: {
            // 425.3.a：未指明张数 → 展示该区域当前全部牌。
            player: {
              kind: "linked-value",
              instructionId: "insightful-investigator.choose-opponent",
              key: "chosenOpponent"
            },
            zone: { kind: "constant", value: "hand" }
          }
        },
        {
          id: "insightful-investigator.may-pay",
          linkedTo: "insightful-investigator.reveal-hand",
          // 383.3.b / 204.3.a：结算时的可选费用与随后的选择；契约 3.9 把被选指令包进 body。
          op: "choice.optional",
          args: {
            prompt: {
              kind: "constant",
              value: "Pay 2 XP to choose a card from their hand?"
            },
            body: {
              kind: "constant",
              value: [
                {
                  id: "insightful-investigator.pay-xp",
                  // “pay 2 XP”：730.2 的 Spend XP；结算时付费的指令原语未合入（见 judgeReason），
                  // 这里按已合入卡牌程序的 cost.pay 形状书写，真实支付由费用管线负责。
                  op: "cost.pay",
                  args: {
                    payments: {
                      kind: "constant",
                      value: [{ kind: "xp", amount: { kind: "constant", value: 2 } }]
                    }
                  }
                },
                {
                  id: "insightful-investigator.discard-chosen",
                  linkedTo: "insightful-investigator.pay-xp",
                  op: "effect.discard",
                  args: {
                    amount: { kind: "constant", value: 1 },
                    // 「they discard」：执行者是刚才选定的对手（190.6.d）。
                    player: {
                      kind: "linked-value",
                      instructionId: "insightful-investigator.choose-opponent",
                      key: "chosenOpponent"
                    },
                    pick: { kind: "constant", value: "insightful-investigator.revealed-card" }
                  },
                  picks: [
                    {
                      id: "insightful-investigator.revealed-card",
                      // 选项来自上一条 reveal 的实际结果（契约 3.9 的 linked-value）。
                      options: [
                        {
                          kind: "linked-value",
                          instructionId: "insightful-investigator.reveal-hand",
                          key: "revealed"
                        }
                      ],
                      // 355.10.a：手牌里的牌不是目标；423.1.a：由执行者选择弃哪张。
                      filter: { zone: "hand" },
                      min: 1,
                      max: 1,
                      selection: "one"
                    }
                  ]
                },
                {
                  id: "insightful-investigator.draw-1",
                  // “discard that card and draw 1”：同一从句里的两个独立动作（359.3.e.14.c），
                  // 不与弃牌互链；抽牌者仍是该对手（190.6.d），并随整组一起受 “If you do” 约束。
                  op: "effect.draw",
                  args: {
                    amount: { kind: "constant", value: 1 },
                    player: {
                      kind: "linked-value",
                      instructionId: "insightful-investigator.choose-opponent",
                      key: "chosenOpponent"
                    }
                  }
                }
              ]
            }
          }
        }
      ]
    }
  ],
  sourceText:
    "When you play me, choose an opponent. They reveal their hand. You may pay 2 XP to choose a card " +
    "from their hand. If you do, they discard that card and draw 1."
} satisfies CardProgram;

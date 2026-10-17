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
 *   里的对象不是目标），因此是非目标 pick；本卡先由能力控制者选牌，再由对手弃掉指定牌；不能套用 423.1.a 的默认弃牌者选择。
 * - “If you do, they discard that card and draw 1”：359.3.e.14 的 “If you do” 从句以“可选部分是否
 *   被执行”为准，因此付费、选牌弃牌、抽牌全部位于 choice.optional 的 body 内——拒绝时整组指令
 *   都不执行（契约 3.9 的“可以……”形状）。body 内 cost.pay → effect.discard 用 linkedTo 表达
 *   383.3.b 的 Cost within Instructions 与其 Effect（“pay 2 XP to choose a card”）；
 *   “discard that card and draw 1” 是同一从句里的两个独立动作（359.3.e.14.c），互不链接。两者
 *   都由该对手执行（effect.discard / effect.draw 的 player = 本程序链接的对手，190.6.d）。
 *
 * status = judge-required（按当前 HEAD 复核；缺口不近似实现）：
 * - 玩家目标仍缺：指令注册表没有 target.player（实测 instructionDefinitionsById.has("target.player") === false），
 *   把本卡原始 body 交给生产解释器即抛 Error "Unregistered instruction opcode: target.player"；
 *   targets() 也只承载 ObjectRef。
 * - 揭示后由能力控制者选择对手手牌的非目标 pick 仍无消费方：PickSpec.options 不会绑定成
 *   选择（生产链路只从 zoneSlice 或 linked 结果提供选项，且 TestWorld.picks 只回放调用方
 *   预先 set 的集合），effect.discard 的实际选择由弃牌者（player = 对手）以 chooser-only 做出
 *   （实测选择请求 chooser "B"、visibility chooser-only），不是 204.3.a 的「you choose」。
 * - 结算时可选费用的可支付性选择与失败恢复仍缺：cost.pay 本体已合入并真实扣款、返回 receipt
 *   （golden 有证据），XP 不足时抛 CostPlanError(reason "cannot-pay-cost", "Insufficient XP")；
 *   但解释器不为可选的 choice.optional body 提供“先探测可支付性再决定要不要执行”的分支，
 *   也没有把失败回退到“整组指令都不执行”的控制流。
 * effect.reveal 与 effect.discard/effect.draw 本体、以及 cost.pay 的 receipt 绑定都有执行证据。
 */
export default {
  canonicalCardId:
    "card.hash-c9dc0b3daad63f09feabdf740bc69b2b327719079fe5d68568f0f4680d45abd2",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "仍缺三处：(1) target.player 的玩家目标及对手集合接线（CR 355.7/355.9.a）：指令注册表无该原语（实测 has(\"target.player\") 为 false，" +
    "原始 body 交给生产解释器抛 Unregistered instruction opcode: target.player），targets() 也只承载 ObjectRef。" +
    "(2) 揭示后由能力控制者选择对手手牌的非目标 pick 生命周期（204.3.a、355.10.a）：PickSpec.options 不绑定成选择，" +
    "effect.discard 的实际选择由弃牌者作出（实测请求 chooser=B、visibility=chooser-only），不能冒充「you choose」。" +
    "(3) 结算时可选支付的可支付性选择与失败恢复（383.3.b、204.3.a）：cost.pay 本体已能扣款并返回 receipt，" +
    "XP 不足时抛 CostPlanError(cannot-pay-cost, \"Insufficient XP\")；缺的是解释器在运行前提供的可选支付分支与失败回退控制流。",
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
                  // “pay 2 XP”：730.2 的 Spend XP；cost.pay 接受已求值的 finalized payment value，
                  // 生产结算仍需处理
                  // 可选费用的可支付性选择与失败恢复。
                  op: "cost.pay",
                  args: {
                    payments: {
                      kind: "constant",
                      value: { xp: 2 }
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
                      // 355.10.a：手牌里的牌不是目标；此处由能力控制者先选择，对手随后弃牌。
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

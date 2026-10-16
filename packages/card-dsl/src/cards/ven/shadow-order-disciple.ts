import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Shadow Order Disciple (ven-095-166) — Unit, 2 Energy, Might 2, Chaos, tag Ionia.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-095-166，逐字）：
 *   When I move, you may [Burn 1] to give me +1 :rb_might: this turn. (To Burn 1,
 *   put the top card of your Main Deck into your trash.)
 *
 * 规则依据（Core Rules v1.5）：
 * - 421.1 / 449.1 / 449.2 / 458：“When I move” 指本永久物在 Board 上成功更换位置后的触发；
 *   封闭时点 "object-moved"（events/timing-points.ts 的 movement 载荷，ruleRefs 421.1/
 *   449.1/449.2/458；时点说明明确"成功完成 Move"，Recall/入场/Attach 不算 Move）。
 * - 403.1 / 契约 3.9：“you may [Burn 1] to …” 的首段 "you may" 是触发能力的可选执行
 *   （optional = true），被选指令包进 choice.optional 的 body。
 * - 740.4.a：“[Burn 1] to give me +1 :rb_might: this turn” 是 "[do X] to [do Y]" 结构——
 *   [do X] = Burn 1（费用），[do Y] = 临时 Might 修正；740.4.a.2 规定触发能力效果首段的
 *   费用在 Finalization 支付，因此 Burn 写成费用计划的付款组件（payments），不是结算时的
 *   effect.mill。(To Burn 1, …) 是 Burn 动作格式的提示文本（441.1 / 441.2），不是第二条能力。
 * - 441.1：Burning 就是把主牌库顶的牌移入弃牌区；441.3.a 说明只在游戏效果或费用指示时执行。
 *   已合入的 effect.mill 是「效果指示」的入口；作为费用的 Burn 需要 cost/plan-values.ts 的
 *   付费种类（当前非标准费用只有 exhaust/discard/recycle/kill/reveal/spend-buff，没有 burn）。
 * - “give me +1 :rb_might: this turn”：临时 Might 修正（479.4.e.1；到期在 315.4 / 317.2.c
 *   的回合结束清理），属 layers 的 continuous.might，不是 Buff 计数器（702/703）。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required，缺口见 judgeReason。
 * golden 用真实解释器执行拒绝分支与 effect.mill 本体（“Burn 1” 的动作语义），未合入部分写 test.todo。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "object-moved",
      filter: { event: "object-moved", filter: { source: "self" } }
    },
    optional: true,
    body: [
      {
        id: "shadow-order-disciple.may-burn-and-grant",
        op: "choice.optional",
        args: {
          prompt: {
            kind: "constant",
            value: "Burn 1 to give me +1 :rb_might: this turn?"
          },
          body: {
            kind: "constant",
            value: [
              {
                id: "shadow-order-disciple.pay-burn-1",
                // 740.4.a.2：触发能力效果首段的费用在 Finalization 支付。[Burn 1] 是
                // 441.1 的费用型 Burn；cost/plan-values.ts 的非标准费用种类没有 burn
                //（RIFT-89），且 cost.pay 没有已合入的原语文件。形状如实记录，
                // 不把费用降级成结算期的 effect.mill。
                op: "cost.pay",
                args: {
                  payments: {
                    kind: "constant",
                    value: [{ kind: "burn", amount: 1 }]
                  }
                }
              },
              {
                id: "shadow-order-disciple.give-plus-1-might",
                // 「give me +1 :rb_might: this turn」：临时 Might 修正的 IR 形状；
                // effects/instructions/ 下没有注册该 op（见 judgeReason 第 2 条）。
                op: "effect.might-modify",
                linkedTo: "shadow-order-disciple.pay-burn-1",
                args: {
                  amount: { kind: "constant", value: 1 },
                  duration: { kind: "constant", value: "this-turn" },
                  // “me” 是能力宿主：355.10.d/g 的按特征自我指代不是目标，用契约 3.6 的
                  // 符号选择器 source（能力来源），不写 TargetSpec。
                  object: { kind: "constant", value: { kind: "source" } }
                }
              }
            ]
          }
        }
      }
    ]
  }
];

export default {
  canonicalCardId: "card.hash-52a663e5dda4322708485527cce1866c32eed631d3d1ad01e401569b5f72e267",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口：(1) 费用型 Burn 不可支付——“[Burn 1] to …” 是 740.4.a.2 在 Finalization 支付的费用" +
    "（441.1 定义 Burn、441.3.a 限定其只在效果或费用指示时执行），但 cost/plan-values.ts 的非标准费用" +
    "种类只有 exhaust/discard/recycle/kill/reveal/spend-buff，没有 burn，且 cost.pay 没有已合入的原语" +
    "文件（effects/instructions 只有 effect.*；费用计划接线属 RIFT-89，同 sfd/minefield 一类缺口的记录）。" +
    "(2) “give me +1 :rb_might: this turn” 是带 end-of-turn 期限的临时 Might 修正（479.4.e.1，到期在 " +
    "315.4 / 317.2.c 的回合结束清理）：契约 3.6 的封闭 GameAction 集合没有 Might 修改动作，连续修正在 " +
    "layers 引擎可求值但卡牌侧没有指令入口（RIFT-91 只合入图层引擎与 duration）；effect.buff 只处理 " +
    "702/703 的 Buff 计数器，不能近似。(3) object-moved 触发进不了链——时点在封闭枚举中（421.1/449.1），" +
    "但没有已合入订阅方把 CardProgram 的 triggered ability 注册成 TriggerRegistration（chain/engine.ts " +
    "只注册延迟触发；RIFT-120，契约 §7.2 批 5）。已支持部分：effect.mill（441.1/441.2/441.4 的 Burn 动作语义）" +
    "与 choice.optional 的“可以”语义（403.1）都由 golden 用真实解释器 + 参考内核执行。依赖：RIFT-89、RIFT-91、" +
    "RIFT-120。不近似实现。",
  abilities,
  sourceText:
    "When I move, you may [Burn 1] to give me +1 :rb_might: this turn. (To Burn 1, put the top card " +
    "of your Main Deck into your trash.)"
} satisfies CardProgram;

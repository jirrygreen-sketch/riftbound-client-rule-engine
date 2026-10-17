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
 *   作为费用的 Burn 写成 cost.pay（原语已合入），但 cost.pay 的 payments 形状只接受
 *   energy/power/xp 键；kind burn 使费用计划返回 cannotPay 并抛 CostPlanError
 *   （cost/plan-values.ts 的非标准种类只有 exhaust/discard/recycle/kill/reveal/spend-buff，
 *   没有 burn——RIFT-89 的付费种类缺口）。
 * - “give me +1 :rb_might: this turn”：临时 Might 修正（479.4.e.1；到期在 315.4 / 317.2.c
 *   的回合结束清理），属 layers 的 continuous.might，不是 Buff 计数器（702/703）。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required，缺口见 judgeReason。
 * golden 用真实解释器执行拒绝分支、continuous.might 本体与 object-moved 触发绑定；
 * 未合入部分（burn 付费种类、端到端链）写 test.todo。
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
                // 441.1 的费用型 Burn；cost.pay 原语已合入，但其 payments 键只接受
                // energy/power/xp，burn 会在费用计划里 cannotPay（RIFT-89 的
                // 付费种类缺口）。形状如实记录，不把费用降级成结算期的 effect.mill。
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
                // 「give me +1 :rb_might: this turn」：临时 Might 修正（479.4.e.1，
                // 到期在 315.4 / 317.2.c 的回合结束清理），用已合入的 continuous.might
                // 原语（arithmetic 图层；RIFT-91）。
                op: "continuous.might",
                linkedTo: "shadow-order-disciple.pay-burn-1",
                args: {
                  amount: { kind: "constant", value: 1 },
                  duration: { kind: "constant", value: "this-turn" },
                  // “me” 是能力宿主：355.10.d/g 的按特征自我指代不是目标，
                  // appliesTo: "self" 是 continuous.might 的来源简写（与显式选择器互斥）。
                  appliesTo: { kind: "constant", value: "self" }
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
    "两处缺口，均不近似实现：(1) 费用型 Burn 不可支付——“[Burn 1] to …” 是 740.4.a.2 在 Finalization " +
    "支付的费用（441.1 定义 Burn、441.3.a 限定其只在效果或费用指示时执行）；cost.pay 原语已合入，但其 " +
    "payments 形状只接受 energy/power/xp 键，kind burn 使费用计划返回 cannotPay 并抛 CostPlanError，" +
    "cost/plan-values.ts 的非标准付费种类只有 exhaust/discard/recycle/kill/reveal/spend-buff，没有 burn" +
    "（RIFT-89 的付费种类缺口）。(2) 端到端可执行依赖该费用：可选触发（choice.optional，403.1）进入 " +
    "cost.pay(burn) 的 Finalize 付费时被 (1) 阻塞，因此整条 move → may → pay → +1 Might 链无端到端" +
    "执行证据。已合入并可用：continuous.might 原语（RIFT-91，479.4.e.1 的临时 Might 修正，this-turn " +
    "别名映射为 end-of-turn 到期）以 appliesTo: self 表达 “me”；object-moved 时点及其生产接线、" +
    "translateTriggerFilter 的 self 锚点解析与 RIFT-257 的程序触发注册（registerProgramTriggers）均已合入，" +
    "golden 分别真实执行 continuous.might 与触发绑定。依赖：RIFT-89（burn 付费种类）。不近似实现。",
  abilities,
  sourceText:
    "When I move, you may [Burn 1] to give me +1 :rb_might: this turn. (To Burn 1, put the top card " +
    "of your Main Deck into your trash.)"
} satisfies CardProgram;

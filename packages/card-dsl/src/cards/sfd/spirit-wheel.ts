import type { CardProgram } from "../../ir/index.js";

/**
 * Spirit Wheel (sfd-144-221) — Gear, 2 energy, Might null, Chaos, 无标签。
 *
 * sourceText（逐字取自 packages/card-data/data/deck-catalog.json sfd-144-221）：
 *   "When you choose a friendly unit, you may pay :rb_energy_1: and exhaust this to draw 1."
 *
 * 规则依据（CR v1.5）：
 * - 383.4.b / 383.4.b.1 / 383.4.b.3："When you choose …" 是 Targeting Effect——条件为某个
 *   Game Object 成为目标；355.6/355.7 规定"choose"指定具体对象即受 Targeting 约束。封闭
 *   时点里对应 became-target（events/timing-points.ts，ruleRefs 355.7/383.4.b）。
 * - "a friendly unit"：740.1.a 的 friendly = 与该能力控制者同控制者；事件目标用
 *   ObjectFilter 的 PlayerSelector "self"（引擎把它解析为"等于触发控制者"）。
 * - "you may pay :rb_energy_1: and exhaust this to draw 1"：383.3.b / 383.3.b.1 规定紧跟
 *   效果开头 "you may" 的 [do X] to [do Y] 是该触发能力的基础费用，必须在 Finalize 支付；
 *   383.3.a 的"是否执行"决定由 TriggeredAbility.optional 承载，契约 3.9 要求把被选择的
 *   指令包进 choice.optional 的 body（不用 choice + linkedTo）。
 * - "draw 1"：414.1 / 414.3，抽牌者缺省为能力控制者（190.6.d）。
 *
 * status = judge-required（2026-10-18 复核；成本内基础费用仍不可执行，不近似实现）：
 * - 触发侧已合入：CardProgram → TriggerRegistration 的绑定层把本卡的 became-target
 *   订阅注册进 events/pipeline（golden 实测 spec.at = became-target、target 过滤解析为
 *   controller: self）。但 TriggerRegistration.cost / mayAtFinalize 仍是 undefined：
 *   programs/triggers.ts 不从正文提取前导费用，383.3.a/383.3.e.2 要求「you may」在
 *   Finalize 决定、383.3.b/404.1.b.1 要求后续费用作为基础费用在该步支付；
 *   契约 3.1 的 TriggeredAbility 也没有 cost 字段可承载它。
 * - 费用侧缺口在「卡侧拼写」而不是付费器：已合入的 cost.pay 结算器本身能支付一个带
 *   exhaust 动作的 finalized 计划（golden 实测 { finalized: true, energy: 1,
 *   exhaust: [ObjectRef] } 真的扣 1 Energy 并横置宿主）。但静态 IR 无法产生该计划：
 *   cost.pay 的 argsSchema 只接受 { cost/power/nonstandardOrder/payments/linkKey }，
 *   本卡的 energy: 键实测被 TypeError: Invalid cost.pay argument: energy 拒绝；
 *   可接受的 payments 计划形态只允许 energy/power/xp 资源键，而把「and exhaust this」写成
 *   { kind: "exhaust", object: "self" } 之类的符号引用会走到 payablePlan，实测抛
 *   CostPlanError("cannot-pay-cost")——静态 IR 里没有把 self 变成运行时 ObjectRef 的绑定。
 *   把横置降级为结算期 effect.exhaust 会改变 383.3.b 的支付时点（405.2 允许在付费步拒付），
 *   属近似实现。
 * - 已可真实执行的部分：became-target 订阅、effect.draw 本体，以及带 exhaust 动作的
 *   finalized 费用计划结算（golden 均用生产代码执行）。
 */
export default {
  canonicalCardId: "card.hash-498c7e8ce2e20ef011de716db7cf2ff6e0f71a410cc40dace65553df8b0b2518",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "触发侧已可绑定：programs/triggers.ts 把本卡的 became-target 订阅注册进 events/pipeline（golden 实测 " +
    "spec.at = became-target、target 过滤解析为 controller: self），但 TriggerRegistration.cost/mayAtFinalize 仍实测为 undefined——" +
    "绑定层不从正文提取前导费用与 383.3.a 的 Finalize「you may」决定，契约 3.1 的 TriggeredAbility 也没有 cost 字段承载它。" +
    "「you may pay :rb_energy_1: and exhaust this」按 CR 383.3.b/383.3.b.1/404.1.b.1 是该触发能力的基础费用、必须在 Finalize 支付；" +
    "缺口在卡侧拼写而非付费器：已合入的 cost.pay 结算器实测能支付带 exhaust 动作的 finalized 计划" +
    "（{ finalized: true, energy: 1, exhaust: [ObjectRef] } 真的扣 1 Energy 并横置宿主）。但静态 IR 产生不了该计划：" +
    "cost.pay 的 argsSchema 只接受 { cost/power/nonstandardOrder/payments/linkKey }，静态 IR 的 energy: 键实测被拒绝" +
    "（TypeError: Invalid cost.pay argument: energy），可接受的 payments 计划形态只允许 energy/power/xp；" +
    "写成 { kind: \"exhaust\", object: \"self\" } 之类的符号引用会走到 payablePlan，实测抛 CostPlanError(cannot-pay-cost)——" +
    "静态 IR 里没有把 self 绑定成运行时 ObjectRef 的路径。effect.draw 本体与 became-target 订阅已合入并单独执行；" +
    "不近似实现（不把横置改写成结算期 effect.exhaust，也不把费用写成免费）。" +
    "依赖：契约变更请求（TriggeredAbility 增加基础费用字段）+ programs/triggers.ts 的 cost/mayAtFinalize 提取与 " +
    "非 standard 支付对象的运行时引用接线。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        // 383.4.b：Targeting Effect；355.6/355.7：choose 指定对象即 Targeting。
        at: "became-target",
        filter: {
          event: "became-target",
          // "you choose" → 做出选择的玩家是能力控制者。
          player: "self",
          // "a friendly unit" → 与控制者同阵营的单位（740.1.a）。
          target: { type: "unit", controller: "self" }
        }
      },
      // 383.3.a / 383.3.e.2：效果开头的 "you may" 是触发能力自身的执行决定。
      optional: true,
      body: [
        {
          id: "spirit-wheel.may-pay-and-draw",
          // 契约 3.9："可以……"包成 choice.optional，被选指令（付费 + 抽牌）在 body 里。
          op: "choice.optional",
          args: {
            prompt: {
              kind: "constant",
              value: "Pay :rb_energy_1: and exhaust Spirit Wheel to draw 1?"
            },
            body: {
              kind: "constant",
              value: [
                {
                  id: "spirit-wheel.pay",
                  // 383.3.b / 383.3.b.1：1 energy + Exhaust this 是基础费用、Finalize 支付；
                  // cost.pay 原语与费用管线接线见 judgeReason。
                  op: "cost.pay",
                  args: {
                    energy: { kind: "constant", value: 1 },
                    payments: { kind: "constant", value: [{ kind: "exhaust", object: "self" }] }
                  }
                },
                {
                  id: "spirit-wheel.draw-1",
                  linkedTo: "spirit-wheel.pay",
                  // 414.1 / 414.3：抽牌者隐含为能力控制者（190.6.d）。
                  op: "effect.draw",
                  args: { amount: { kind: "constant", value: 1 } }
                }
              ]
            }
          }
        }
      ]
    }
  ],
  sourceText:
    "When you choose a friendly unit, you may pay :rb_energy_1: and exhaust this to draw 1."
} satisfies CardProgram;

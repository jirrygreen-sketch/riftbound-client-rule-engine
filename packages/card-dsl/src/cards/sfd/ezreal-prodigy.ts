import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Ezreal, Prodigy (sfd-149-221) — Unit, Chaos, Ezreal/Piltover/Champion.
 * energy 3, power 1, Might 3.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, sfd-149-221，逐字，含换行）:
 *   "When you play me, discard 1, then draw 2.\n"
 *   "Optional additional costs you pay cost :rb_energy_1: or :rb_rune_rainbow: less."
 *
 * 规则依据（CR v1.5）：
 * - "When you play me"：383.4.a / 383.4.a.1 的 Play Effect（420.4.a），时点 card-played，
 *   filter 用内层锚点 source: "self" 指称本卡（已合入 sfd/sandshifter、ogn/the-good-stuff 同型）。
 * - "discard 1, then draw 2"：423.1 的效果弃牌（弃牌者缺省为能力控制者，190.6.d；
 *   423.1.a 允许执行者选择弃哪张，355.10.a 说明手牌选择是非目标选择，因此不写 TargetSpec），
 *   及 414.1/414.3 的抽牌。"then" 是次序，两条独立指令各自执行（055：前一条被否决不阻止不引用它的后续指令）。
 * - "Optional additional costs you pay cost [1] or [A] less"：356.2.b / 356.2.b.1 定义可选附加费用，
 *   356.4 / 356.4.f 说明折扣可以作用于附加费用，356.4.c 进一步说明只作用于某个组件的折扣
 *   在该组件加入费用时应用（356.4.c 的示例正是本卡）；356.4.f.1 规定"可选附加费用是否已付"
 *   看的是玩家做出的支付决定。"[A]" 是 163.2.b 的 Universal Power（任意域力量）。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required。
 * - "discard 1" 与 "draw 2" 都用已合入的 effect.discard / effect.draw，golden 对这两条真实执行。
 * - 改费半段没有消费方：effects/instructions/ 仍未注册 cost.modify 原语（RIFT-261 进行中），
 *   cost/cost-plan.ts 只在调用方显式提供 CostPlanInput.discounts 时应用折扣（356.4.c 的组件折扣、
 *   356.4.f.1 的"已付决定"凭证都是该管线的职责），且 CostDiscount 的 component 维度目前只在 base/output
 *   阶段生效——没有"仅作用于可选附加费用"与"以支付决定为条件"的接线；本卡的 static 能力也还没有
 *   CardProgram → 费用计划的注册路径（RIFT-257）。
 * - "or [A]" 的 Universal Power（163.2.b）无法用封闭 Domain 类型与 CostDiscount.resource 表达；
 *   effect.resources 明确该资源保持 unsupported、绝不用具名域近似。
 * 依赖：RIFT-261（费用计划的附加费用折扣接线）、RIFT-257（卡牌 static 注册）、Universal Power 的契约变更请求。
 * 不近似实现：不把 [A] 写成某个具名域，也不把改费写成副作用式的额外动作。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "card-played",
      filter: { event: "card-played", filter: { source: "self" } }
    },
    optional: false,
    body: [
      {
        // 423.1 / 423.1.a：效果弃牌 1，弃牌者缺省为能力控制者（190.6.d），手牌选择是非目标选择。
        id: "ezreal-prodigy.discard-1",
        op: "effect.discard",
        args: { amount: { kind: "constant", value: 1 } }
      },
      {
        // 414.1 / 414.3：独立指令；弃牌被否决不阻止本条的抽牌（055）。
        id: "ezreal-prodigy.draw-2",
        op: "effect.draw",
        args: { amount: { kind: "constant", value: 2 } }
      }
    ]
  },
  {
    kind: "static",
    effect: {
      // 356.2.b / 356.4 / 356.4.c / 356.4.f：只作用于可选附加费用组件的减费。
      kind: "continuous.cost-modification",
      stage: "discount",
      component: "optional-additional",
      resource: "energy",
      amount: { kind: "constant", value: 1 },
      // 356.4.b / 163.2.b 的二资源减费：[1] Energy 或 1 点 [A]（Universal Power）。
      alternative: {
        resource: "power",
        universal: true,
        amount: 1
      },
      appliesTo: "optional-additional-costs-you-pay"
    }
  }
];

const program = {
  canonicalCardId: "card.hash-88ad91a69950ae1cab7ff15331a758eeeb0d0042e84133e1a35faee954d7807d",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "改费半段没有消费方：「Optional additional costs you pay cost [1] or [A] less」按 356.2.b / 356.4 / 356.4.c / 356.4.f " +
    "是只作用于可选附加费用组件的折扣（356.4.f.1 的已付凭证是玩家的支付决定），但 effects/instructions/ 没有注册 cost.modify 原语，" +
    "cost/cost-plan.ts 只在调用方显式提供 CostPlanInput.discounts 时应用，且 CostDiscount 没有「仅作用于可选附加费用」与「以支付决定为条件」的维度（RIFT-261 进行中）。" +
    "同时「or :rb_rune_rainbow:」的 [A] 是 163.2.b 的 Universal Power：封闭 Domain 类型与 CostDiscount.resource 不表达，" +
    "effect.resources 明确保持 unsupported、不用具名域近似。" +
    "「When you play me, discard 1, then draw 2」两条指令已合入（423.1 / 414.3），golden 对锁定手牌与牌库真实执行，触发接线记 test.todo。" +
    "依赖：RIFT-261（cost.modify 原语与附加费用折扣接线）、RIFT-257（卡牌 static 注册）、Universal Power 的契约变更请求。" +
    "不近似实现。",
  abilities,
  sourceText:
    "When you play me, discard 1, then draw 2.\n" +
    "Optional additional costs you pay cost :rb_energy_1: or :rb_rune_rainbow: less."
} satisfies CardProgram;

export default program;

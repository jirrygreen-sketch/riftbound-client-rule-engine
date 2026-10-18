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
 * Status: judge-required (2026-10-18 re-check). The discard/draw body executes with merged primitives.
 * cost.modify and buildCostPlan already support discounts on selected optional
 * components and retain the decision to pay even for a zero total (356.4.f.1).
 * The missing adapter is the static scope: programs/statics.ts cannot bind
 * continuous.cost-modification or optional-additional-costs-you-pay, so no
 * rule discovers each payable component and offers its Energy/Power discount.
 * Reducing a Power requirement does not create a Universal Power resource.
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
    "当前唯一阻断是 static → 可选附加费用组件折扣的生产绑定（2026-10-18 实测，CR 356.4/356.4.c/356.4.f.1）：弃 1 抽 2 已由 effect.discard/effect.draw 真实执行；" +
    "cost/discounts/collect.ts、cost.modify 和 buildCostPlan 已支持按组件 ID 收集折扣、在 CostPlanInput.discounts 的 selected optionalAdditional 上展开本卡范围，" +
    "并对 Energy / Universal Power（163.2.b）两种减费分支做真实选择。生产 programs/statics.ts 的 layerFor 仍不识别 " +
    "continuous.cost-modification，staticTarget 也不接受 optional-additional-costs-you-pay，chain/engine.ts 因而不会在 Finalize " +
    "把本卡静态声明和可选费用决定交给该收集器。Power 减费是费用需求的减少，不需要伪造一个 Universal Power 资源；" +
    "在该静态绑定接线合入前整卡保持 judge-required。",
  abilities,
  sourceText:
    "When you play me, discard 1, then draw 2.\n" +
    "Optional additional costs you pay cost :rb_energy_1: or :rb_rune_rainbow: less."
} satisfies CardProgram;

export default program;

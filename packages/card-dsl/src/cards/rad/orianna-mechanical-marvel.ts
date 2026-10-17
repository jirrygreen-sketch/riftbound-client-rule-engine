import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * rad-068-167 Orianna, Mechanical Marvel（能量 5、Power 无印刷值、Might 5、
 * 领域 Mind、标签 Piltover/Orianna/Champion；alternate rad-068a-167 同 canonical
 * 且原文相同）。
 *
 * 原文（逐字，已对照官方卡图）：
 *   Once each turn, while I'm at a battlefield, you may pay :rb_energy_1::rb_rune_rainbow:
 *   less to play a gear.
 *
 * 规则依据（CR v1.5）：
 * - 这是一条 Conditional Passive / Continuous 的费用改写（364.3 的 "while" 条件；
 *   366.2 "Passive Abilities can alter the costs of cards as they are played"，
 *   366.2.a 在可以由该能力打出的任何区域都适用）。改写发生在 Determine Total Cost
 *   （404.2/404.3）之前，因此它必须作为 static 持续效果声明，由费用管线在 Finalize
 *   时消费，而**不能**写成结算期指令（那会变成"先结算再打折"）。
 * - 减少量是 1 Energy + 1 rainbow rune（135.2.e.5 的 [A]：可用任意领域的 Power 支付；
 *   作为折扣时即"少付 1 Energy 与 1 点任意领域的 Power"）。
 * - "while I'm at a battlefield"：条件是我（来源单位）在某个 Battlefield
 *   （141.1.a.1 的位置种类），不是 Base。
 * - "Once each turn"：同一回合只用一次（once: "per-turn" 语义），是这条持续效果
 *   的用量限制。
 * - "while … you may pay … less to play a gear" 的受益者是本卡控制者打出的 gear。
 *
 * 状态：judge-required。缺口：
 * 1. continuous.cost-modification 尚无费用 Finalize 消费方；当前折扣只能由
 *    CostPlanInput.discounts 调用者显式传入。
 * 2. "Once each turn" 的用量限制需要引擎记录本回合是否已用，当前
 *    ContinuousEffectSpec/Duration 无该字段。
 * 3. 条件"我在 battlefield"需要位置读取，这条本身可用（ObjectSnapshot.location 已存在），
 *    但把它接成持续效果的条件求值仍依赖上述消费方。
 * 依赖：费用 Finalize 消费方与持续效果的 per-turn 使用计数。
 * 不近似实现：不把这条写成结算期 effect.resources 或把折扣近似成固定 Energy 减费。
 */
const abilities: Ability[] = [
  {
    kind: "static",
    effect: {
      kind: "continuous.cost-modification",
      resource: "energy",
      amount: { kind: "constant", value: -1 },
      // 1 rainbow rune = 1 Power of any domain（135.2.e.5 / 163.2.b 的任意领域 Power）。
      power: {
        kind: "constant",
        value: { amount: -1, domain: "any" }
      },
      appliesTo: { kind: "constant", value: { type: "gear", controller: "controller" } },
      // 404.2/404.3：折扣在总费用确定前生效。
      stage: { kind: "constant", value: "total-cost" },
      once: { kind: "constant", value: "per-turn" }
    },
    condition: {
      kind: "compare",
      left: {
        kind: "object-property",
        object: "self",
        property: "location"
      },
      operator: "eq",
      right: { kind: "constant", value: "battlefield" }
    }
  }
];

const program = {
  canonicalCardId:
    "card.hash-d4ef90d20d4782edbcabe8cd157c2b6565e5c53b930df73f688bd58c0289d3a1",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "2026-10-17 复核：该能力已正确表达为 static 的 continuous.cost-modification，" +
    "但费用 Finalize 尚无消费方把 1 Energy 与 1 any-domain Power 折扣应用到控制者打出的 gear。" +
    "此外，ContinuousEffectSpec/Duration 没有 once-per-turn 使用计数，无法落实同一回合只用一次。" +
    "while-at-a-battlefield 的位置条件仍需由上述消费方在费用结算时求值；不把折扣近似成结算期资源指令。",
  abilities,
  sourceText:
    "Once each turn, while I'm at a battlefield, you may pay :rb_energy_1::rb_rune_rainbow: less to play a gear."
} satisfies CardProgram;

export default program;

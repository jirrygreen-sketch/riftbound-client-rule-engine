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
 * 状态：judge-required（2026-10-18 再复核，逐条实测）：
 * 1. 生产静态绑定仍拒绝本声明：programs/statics.ts 的 staticTarget 只接受
 *    "self"/"source" 或省略 appliesTo，实测 Unsupported static appliesTo
 *    {"type":"gear","controller":"controller"}；去掉受益者过滤器后 layerFor 又对
 *    continuous.cost-modification 抛 "has no layer mapping"。
 * 2. RIFT-709 已合入的收集器（cost/discounts/collect.ts 的 finalizeCostPlan /
 *    collectCostModifications）已能真实消费本卡的减费量：`reductions` 的
 *    { energy: -1 } + { power: -1, universal: true }（[A] = 任意域，163.2.b）、
 *    appliesTo 受益者过滤器、stage total-cost 与位置条件都用 merged 词汇表达，
 *    golden 经 finalizeCostPlan 实测：来源在战场时控制者的 gear 从 1 Energy + 1 Power
 *    变为 0/0，来源在基地或对手 gear 时不动。但 chain/engine.ts 的 Finalize 仍只调用
 *    buildCostPlan，programs/statics.ts 也不产出该来源，收集器只能由调用者显式传入，
 *    该模块自己的 README 把 "statics 路由 + chain Finalize 接线" 列为未完成集成请求。
 * 3. "Once each turn" 仍无消费方：连续效果没有每回合使用计数，收集器的字段白名单也
 *    不含 once，实测抛 CostPlanError(judge-required) "Unsupported cost modification field once"
 *    （events/pipeline.ts 的 once 只作用于 TriggerSpec）。
 * 4. 条件"我在 battlefield"可求值：`count(objects) >= 1` 配
 *    object: "self", location: "battlefield"（layers/filter.ts 拼写），实测战场 true、
 *    基地 false（旧写法的 object-property "location" eq "battlefield" 恒 false）。
 * 依赖：CardProgram static → Finalize CostPlanInput 的生产接线（statics 路由 + chain
 * Finalize 调用 finalizeCostPlan，父任务范围）与持续效果 per-turn 使用计数。
 * 不近似实现：不把这条写成结算期 effect.resources 或把折扣近似成固定 Energy 减费。
 */
const abilities: Ability[] = [
  {
    kind: "static",
    effect: {
      kind: "continuous.cost-modification",
      // 356.4：print 的减费同时作用于两种资源。RIFT-709 合入的词汇是 `reductions`：
      // 1 Energy 与 1 点 [A]（135.2.e.5 / 163.2.b 的任意域 Power）。
      reductions: [
        { resource: "energy", amount: { kind: "constant", value: -1 } },
        {
          resource: "power",
          amount: { kind: "constant", value: -1 },
          // universal: true 表示六域任意可支付；不等于产生 Universal 资源。
          universal: true
        }
      ],
      appliesTo: { kind: "constant", value: { type: "gear", controller: "controller" } },
      // 404.2/404.3：折扣在总费用确定前生效。
      stage: { kind: "constant", value: "total-cost" },
      once: { kind: "constant", value: "per-turn" }
    },
    condition: {
      kind: "compare",
      left: {
        // 053.3 的 here / "while I'm at a battlefield"：layers/filter.ts 与
        // 解释器集合查询共用的位置拼写。
        kind: "count",
        subject: "objects",
        filter: { object: "self", location: "battlefield" }
      },
      operator: "gte",
      right: { kind: "constant", value: 1 }
    }
  }
];

const program = {
  canonicalCardId:
    "card.hash-d4ef90d20d4782edbcabe8cd157c2b6565e5c53b930df73f688bd58c0289d3a1",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "2026-10-18 复核：减费量本身已在 merged 词汇里可执行。static 的 continuous.cost-modification " +
    "用 reductions（1 Energy + 1 点 universal Power，356.4 / 163.2.b）与 appliesTo 受益者过滤器表达，" +
    "golden 经 cost/discounts/collect.ts 的 finalizeCostPlan 实测：来源在战场时，控制者打出的 gear " +
    "1 Energy + 1 Power 被减到 0/0；来源在基地或打出对手的 gear 时不减费。" +
    "仍缺两处生产接线：(a) programs/statics.ts 未把本声明注册为费用来源——" +
    "staticTarget 先拒 appliesTo {\"type\":\"gear\",\"controller\":\"controller\"}" +
    "（实测 Unsupported static appliesTo ...），去掉受益者过滤器后 layerFor 又抛 " +
    "Static ability kind continuous.cost-modification has no layer mapping；" +
    "chain/engine.ts 的 Finalize 也只调用 buildCostPlan，没有调用 finalizeCostPlan 收集场上 static，" +
    "因此 finalizeCostPlan 只能由调用者显式传 sources（cost/discounts/README.md 的集成请求 1/2）。" +
    "（b）「Once each turn」仍无消费方：连续效果没有 per-turn 使用计数，收集器的字段白名单也不接受 once，" +
    "实测抛 CostPlanError judge-required「Unsupported cost modification field once」。" +
    "位置条件（我在 battlefield，364.3）已可求值并有执行证据。不把折扣近似成结算期资源指令。",
  abilities,
  sourceText:
    "Once each turn, while I'm at a battlefield, you may pay :rb_energy_1::rb_rune_rainbow: less to play a gear."
} satisfies CardProgram;

export default program;

import type { Ability, CardProgram, Expr } from "../../ir/index.js";

/**
 * Rhasa the Sunderer (ogn-195-298) — Unit, 10 energy + 1 Chaos power, 6 Might.
 *
 * Printed text: “I cost :rb_energy_1: less for each card in your trash.”
 *
 * 规则依据（CR v1.5）：
 * - 356.4 / 356.4.b：“cost [amount] less” 是折扣（Discount），在“3. Determine Total
 *   Cost”的折扣步骤应用；356.4.g：可变折扣的数值在应用时检查。
 * - 356.6：Energy 费用不能被减到 0 以下（折扣不足 10 点时只减到 0）。
 * - 108.2.a：Trash 是每名玩家各自的区域；“your trash” = 本卡的**拥有者/控制者**的 Trash。
 *   折扣是卡牌自身属性（356.4.a：“Discounted by the card being played or by any other
 *   card”），因此本程序把它写成 static + `continuous.cost-modification`，与
 *   sfd/production-surge.ts 的既有做法一致，只声明“要减多少”，具体减费由费用计划消费。
 * - 金额表达式：`arithmetic` 的 `neg` 作用在 `count(subject: "cards", filter:
 *   { zone: "trash", owner: "self" })` 上，即 “每个垃圾场中的牌 -1 能量”。
 *   `count` 与 `arithmetic` 都是类型与解释器已支持的原语级表达式（interpreter README
 *   的 native arithmetic 段），`cost/cost-plan.ts` 也接受 `CostDiscount.amount: Expr`。
 *
 * status 判定（README 第 2 节）：judge-required（复核 2026-10-18）。表达式和
 * Finalize 收集器已经能执行：`finalizeCostPlan` 能按本卡的 `owner: "self"` 计数、锁定
 * -1/Trash 折扣并交给费用支付。剩余缺口在生产 CardProgram/Chain 接线：默认打出路径仍
 * 直接调用 `buildCostPlan`，没有从本卡 static ability 收集 `continuous.cost-modification`
 * 到 `CostPlanInput.discounts`；`programs/statics.ts` 也只负责普通图层绑定，不能把本卡的
 * pre-play 自身费用能力送进该收集器。整卡因此不能宣称 executable。
 */
const trashDiscount: Expr = {
  kind: "arithmetic",
  operator: "neg",
  operands: [
    {
      kind: "count",
      subject: "cards",
      filter: { zone: "trash", owner: "self" }
    }
  ]
};

const abilities: Ability[] = [
  {
    kind: "static",
    effect: {
      kind: "continuous.cost-modification",
      resource: "energy",
      appliesTo: "self",
      // 356.4：每个垃圾场中的牌让本卡少 1 能量；356.6 的下限 0 由费用计划钳制。
      amount: trashDiscount
    },
    condition: { kind: "always" }
  }
];

const program = {
  canonicalCardId: "card.hash-026fc6f43de0b92460fc9a27186ea0fb19fcaa6b9a6bfbb64fb1901c9425c852",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "当前生产缺口（复核 2026-10-18）：356.4.b/356.4.g 的“cost N less for each card in your trash”已经能由 engine-core 的 " +
    "finalizeCostPlan 真实收集并按 owner: \"self\" 计算，但默认 ChainEngine 的打出 Finalize 仍直接调用 buildCostPlan，" +
    "没有把 CardProgram 的 continuous.cost-modification static ability 转成 CostPlanInput.discounts；programs/statics.ts 也没有把 pre-play 自身费用能力接到该收集器。" +
    "因此本卡的实际打出仍缺 CardProgram → Finalize 费用桥接；golden 覆盖收集器、Energy 下限与支付结果，不近似实现生产接线。",
  abilities,
  sourceText: "I cost :rb_energy_1: less for each card in your trash."
} satisfies CardProgram;

export default program;

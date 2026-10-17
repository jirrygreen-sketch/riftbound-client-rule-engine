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
 * status 判定（README 第 2 节）：judge-required。缺口不是表达式，而是**声明通道**：
 * 工程里没有把卡牌侧 `continuous.cost-modification` 静态效果映射到费用计划的消费者——费用计划
 * `buildCostPlan` 的 `discounts` 仍由调用方提供，`programs/statics.ts` 的图层映射也拒绝该
 * effect kind。同时 “self” 这个 owner/牌主占位符只有卡片 IR 语义，费用计划的
 * `ResolveContext.query` 过滤器仍是运行时字面值。
 * 折扣金额表达式本身可由解释器真实执行，golden 测试用解释器 + 参考内核断言减费点数，
 * 并用已合入的 `buildCostPlan` 证明同一表达式能产出 10→7 的 Energy 折扣。
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
    "缺费用改写的卡牌侧声明通道：356.4.b/356.4.g 的 “cost N less for each card in your trash” 需要把本卡的 " +
    "continuous.cost-modification 静态效果读成费用计划的 CostDiscount，但 engine-core 里没有任何消费者——" +
    "buildCostPlan 的 discounts 只由调用方（chain 的费用输入）提供，programs/statics.ts 的 layerFor() 也没有 continuous.cost-modification 的费用层映射；" +
    "同时 amount 里的 owner: \"self\"（本卡拥有者的 trash）没有费用计划侧的解析定义。cost.modify 原语和费用计划本体已合入，折扣点数表达式本身已可由解释器求值，" +
    "golden 测试真实执行并断言 10→7 的减费结果。",
  abilities,
  sourceText: "I cost :rb_energy_1: less for each card in your trash."
} satisfies CardProgram;

export default program;

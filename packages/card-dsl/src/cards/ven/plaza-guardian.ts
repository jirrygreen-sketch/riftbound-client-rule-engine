import type { Ability, CardProgram, Expr } from "../../ir/index.js";

/**
 * Plaza Guardian (ven-064-166) — Unit, 10 Energy, 8 Might, Mind, Mech/Piltover
 * （无印刷 Power）。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-064-166，逐字）：
 *   I cost :rb_energy_1: less for each gear you control.
 *   [Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or
 *   ability.)
 *
 * 规则依据（CR v1.5）：
 * - 356.4 / 356.4.b：“I cost [1] less for each …” 是折扣（Discount），在费用流程
 *   的“3. Determine Total Cost”折扣阶段应用；356.4.g 规定可变折扣在应用时取值。
 *   折扣是打出该牌时的费用改写，不是结算期动作，所以按契约 3.1 写成 static 能力 +
 *   `continuous.cost-modification` 效果（与 ogn-195-298 Rhasa the Sunderer 同形）。
 * - 356.6：折扣不足 10 点时 Energy 只减到 0，下限由费用计划钳制，不写进卡数据。
 * - 355.9.a.1：“gear you control” = Board 上由本卡控制者控制的 gear；控制器用契约
 *   3.6 的符号占位符，卡程序不写运行时 PlayerId。
 * - 809 Deflect：被动能力关键词；809.1.b.3 规定省略数值时 Deflect Value 按 1。
 *   按契约 3.7 / README 第 5 节只声明 `{ kind: "keyword", keyword: "deflect" }`，
 *   展开（static target.tax）由 effects/keywords/Deflect.ts 负责。
 *
 * 当前执行边界见 judgeReason 与对应 golden；保留所有印刷语义。
 */

/** 折扣额：每个“你控制的 gear”让本卡少 1 Energy（356.4.b、356.4.g）。 */
const gearDiscount: Expr = {
  kind: "arithmetic",
  operator: "neg",
  operands: [
    {
      kind: "count",
      subject: "gear",
      filter: { type: "gear", controller: "self", zone: "board" }
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
      // 356.4.b：amount 是减少量（负数表示减费），下限 0 由费用计划钳制。
      amount: gearDiscount
    },
    condition: { kind: "always" }
  },
  {
    // 809.1.b.3：省略数值 ⇒ Deflect 1；本体展开归关键词注册表。
    kind: "keyword",
    keyword: "deflect"
  }
];

export default {
  canonicalCardId: "card.hash-8d3c1fb92524f486e6dc9126c50fabcfa804299c7b5069e2e43ba6329df29f27",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "当前缺口：(1) cost/discounts/collect.ts 的 collectCostModifications / finalizeCostPlan 已能把本卡 continuous.cost-modification 的动态 gear 计数折扣转换成 discounts 并冻结费用（356.4.b/356.4.g/356.6）；但 programs/statics.ts 的 layerFor 没有费用声明路由，chain/engine.ts 仍直接调用 buildCostPlan，未收集打出前自身的 static 折扣。(2) Deflect 已展开为 target.tax，target/tax/collect.ts 与 adapter 已能收集并验证 1 点任意域 Power（809.1.c.1）；该 static kind 仍不能由程序绑定，链默认目标选择也未接入收集器，显式收到的 TargetTaxRequest 仍按 Energy 记账。整卡保持 judge-required，不近似实现。",
  abilities,
  sourceText:
    "I cost :rb_energy_1: less for each gear you control.\n" +
    "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)"
} satisfies CardProgram;

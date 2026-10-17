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
 * status = judge-required（复核 2026-10-17；缺口均不近似实现）：
 * 1. cost.modify / buildCostPlan 的折扣原语已合入（RIFT-258/89 批次），折扣点数表达式
 *    由 golden 真实求值；仍缺的是把这笔折扣安装到打出本卡的费用计划上——没有任何已合入
 *    路径读取 CardProgram 的 static continuous.cost-modification 并生成 discounts
 *    （依赖 RIFT-89 的费用计划接线）。
 * 2. [Deflect] 的链级目标税消费已部分合入：target/target-plan.ts 有 TargetTaxSpec
 *    （kind 必须 "deflect"）、taxAdapter 与 finalizeTargetPlan → appendTaxes，chain/engine.ts
 *    的 finalize 会把税变成 mandatoryAdditional Energy 成本；golden 用真实 target 管线断言
 *    appendTargetTax 收到请求。仍缺：(a) 809.1.c.1 的税是任意域 Power，而链级记账按 Energy
 *    换算；(b) 没有把 Deflect 关键词自动接线成目标税选项（taxAdapter 由调用方提供），
 *    相关进行中任务 RIFT-90/RIFT-360。
 * 折扣点数表达式本身可由解释器真实求值，golden 用解释器 + 参考内核断言
 * “你控制的每个 gear 减 1” 的取值，不宣称整卡可执行。
 */

/** 折扣额：每个“你控制的 gear”让本卡少 1 Energy（356.4.b、356.4.g）。 */
const gearDiscount: Expr = {
  kind: "arithmetic",
  operator: "neg",
  operands: [
    {
      kind: "count",
      subject: "gear-you-control",
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
    "两处缺口，均不近似实现：(1)「I cost :rb_energy_1: less for each gear you control」（356.4 / 356.4.b / 356.4.g）：" +
    "cost.modify / buildCostPlan 的折扣原语已合入（RIFT-258/89 批次），折扣点数表达式由解释器真实求值；" +
    "仍缺把 static continuous.cost-modification 安装到打出本卡的费用计划 discounts 的已合入路径（RIFT-89 接线）；" +
    "(2) [Deflect]（809.1.b.3 省略数值按 1）的链级目标税消费已部分合入：TargetTaxSpec / taxAdapter / " +
    "finalizeTargetPlan→appendTaxes 已在 target/target-plan.ts，chain/engine.ts 的 finalize 把税变成 " +
    "mandatoryAdditional Energy 成本，golden 用真实 target 管线断言 appendTargetTax 收到请求；" +
    "仍缺 (a) 809.1.c.1 的任意域 Power 记账（当前按 Energy 换算）与 (b) Deflect 关键词→目标税选项的自动接线" +
    "（taxAdapter 由调用方提供），依赖 RIFT-90/RIFT-360。" +
    "不近似实现（不改写印刷费用、不把 Deflect 写成假目标税）。",
  abilities,
  sourceText:
    "I cost :rb_energy_1: less for each gear you control.\n" +
    "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)"
} satisfies CardProgram;

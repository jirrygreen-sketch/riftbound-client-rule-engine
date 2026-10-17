import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Keeper of Law (ven-119-166) — Unit, 5 Energy + 1 Order Power, Might 5, Order,
 * tag Shurima.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-119-166，逐字）：
 *   I cost :rb_energy_2::rb_rune_order: less if you control a battlefield with
 *   exactly two units there.
 *
 * 规则依据（CR v1.5）：
 * - 356.4 / 356.4.b / 356.4.c：“cost [amount] less” 是折扣，在确定总费用的折扣步骤
 *   应用；356.4.c.1 允许同一步骤内任意顺序，356.6 规定 Energy 与 Power 不能减到 0
 *   以下（本卡减 2 Energy 与 1 Order Power）。
 * - 356.4.a：折扣可以来自被打出的牌自身，所以本卡把它写成 static 的
 *   continuous.cost-modification，与已合入 ogn/rhasa-the-sunderer 的写法一致
 *   （只声明「减多少」，实际减费由费用计划消费）。
 * - 163.2：:rb_rune_order: 是 1 枚 Order Power；135.2.e.5 的任意域 [A] 不适用。
 * - 「if you control a battlefield with exactly two units there」是这条折扣的条件：
 *   190.4/190.4.a 的战场控制权归玩家；103.3/170.11 的战场是可计数的游戏对象；
 *   「exactly two units there」= 该战场上单位恰好 2 个。静态 IR 里用 count 表达式 +
 *   battlefield-scoped 过滤记录（见 judgeReason 的契约缺口：没有从战场对象取
 *   location 的锚点，
 *   所以这里用结构化占位而不是伪造一个近似过滤器）。
 *
 * status = judge-required（两处缺口，均不近似实现）：
 * 1. cost.modify / cost.pay 原语（effects/instructions/）与 buildCostPlan 的折扣
 *    计划均已合入，但没有已合入路径把 CardProgram 的 static 费用改写送进 Finalize
 *    费用计划：buildCostPlan 只读调用方传入的 CostDiscount；bindStaticToLayers 把
 *    continuous.cost-modification 存入图层时直接 judge-required（layerFor 无该 kind 的
 *    映射），layers/rules/query.ts 也没有把它变成 CostDiscount 的查询。
 * 2. 条件不可诚实求值：需要「我控制的某个战场上有恰好 2 个单位」这一计数谓词，其中
 *    计数锚点是**该战场对象的位置**；冻结的 ObjectFilter 锚点（sameLocationAs 等）只能
 *    从已选对象取位置，没有「按被遍历战场对象自己的位置筛衍生物」的形式，count 也没
 *    有它自己的过滤结果绑定，因此按现状写出的任何过滤器都会作用到错误的集合
 *    （RIFT-359 的图层条件谓词 + 契约增补）。
 */
const abilities: Ability[] = [
  {
    kind: "static",
    effect: {
      kind: "continuous.cost-modification",
      // 356.4.b/356.4.c：整卡的两个费用分量分别减 2 Energy 与 1 Order Power。
      reductions: [
        { resource: "energy", amount: -2 },
        { resource: "power", domain: "Order", amount: -1 }
      ],
      appliesTo: "self"
    },
    condition: {
      kind: "compare",
      left: {
        kind: "count",
        subject: "battlefields-you-control-with-exactly-two-units",
        // “you control a battlefield”：控制者为能力控制者（190.6.d 的隐含 you）。
        // “with exactly two units there”：单位位置等于该战场对象自身的位置——这是
        // ObjectFilter 无法表达的锚点（见 judgeReason 第 2 条），故只写战场侧的正向
        // 过滤（控制器），把单位计数与“该战场自身位置”留在 subject 里说明。
        filter: { type: "battlefield", controller: "controller" }
      },
      operator: "gte",
      right: { kind: "constant", value: 1 }
    }
  }
];

export default {
  canonicalCardId:
    "card.hash-594a92ecf2468e6d6dce94696d391d740b2a698a2ac48085800d89cc1ec137cb",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处缺口，均不近似实现：(1) cost.modify / cost.pay 原语与 buildCostPlan 的折扣计划均已合入，" +
    "但没有已合入路径把 CardProgram 的 static 费用改写安装到这次打出的费用计划上：" +
    "cost/cost-plan.ts 的折扣只读调用方传入的 CostDiscount；bindStaticToLayers 把 " +
    "continuous.cost-modification 存入图层时直接 judge-required（实测错误信息：Static ability kind " +
    "continuous.cost-modification has no layer mapping），" +
    "layers/rules/query.ts 也没有把它变成 CostDiscount 的查询；356.4.f 的“折扣可减附加费”与本卡的" +
    "2 Energy + 1 Order Power 分量按 356.4.b/356.4.c 分别声明。(2) 「if you control a battlefield with exactly two " +
    "units there」不可诚实求值：需要「该战场对象自身位置上有恰好 2 个单位」这一计数谓词，而冻结的 ObjectFilter" +
    "锚点只能从已选对象取位置（sameLocationAs/exclude 等），没有“按被遍历战场对象自己的位置筛选其上的单位”" +
    "的形式，count 也没有自身过滤结果绑定；静态 IR 里只写得出战场侧的正向过滤（type battlefield + controller），" +
    "单位计数与“there”锚点留在 subject 说明里，不作为已可执行的近似（契约增补请求见回复）。依赖：" +
    "RIFT-359（图层条件谓词）与契约的地点锚点增补。",
  abilities,
  sourceText:
    "I cost :rb_energy_2::rb_rune_order: less if you control a battlefield with exactly two units there."
} satisfies CardProgram;

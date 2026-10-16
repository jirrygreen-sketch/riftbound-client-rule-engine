import type { CardProgram } from "../../ir/index.js";

/**
 * Sandswept Tomb (ven-164-166) — Battlefield, Colorless.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-164-166，逐字）：
 *   "Each spell that chooses one or more units here that are friendly to it
 *    costs :rb_rune_rainbow: less."
 *
 * 规则依据（Core Rules v1.5）：
 * - 356.4 / 356.4.a / 356.4.b："costs … less" 是在 Finalize 的费用计算折扣步骤应用的减费；
 *   356.4.a 允许折扣由别的牌提供（此处由战场提供）。356.4.c.2/356.6 保证不会降到 0 以下。
 * - 355.7 / 355.15：法术“choose（选择）”单位即 Targeted；折扣的门槛是该法术最终锁定的目标/选择，
 *   所以它是费用计算时的判定，而不是一条结算期指令。
 * - 135.2.e.5 / 135.2.e.5.a、163.2.b：:rb_rune_rainbow: 是任意域 Power [A]，作为费用可由任意域
 *   Power 支付；因此“少一个 [A]”= 少一条可由任意域支付的 Power 需求。
 * - 053.3："here" 指本战场；740.1.a："friendly to it" 指与施放该法术的牌同一控制者。
 *
 * status = judge-required（缺口均不近似实现）：
 * 1. 没有已合入路径把 CardProgram 的 static 费用改写送进被施放法术的费用计划：
 *    cost/cost-plan.ts 只读调用方传入的 CostDiscount，effects/instructions/ 也没有 cost.modify
 *    原语（RIFT-9 清单要求，属 RIFT-89）。
 * 2. 门槛「该法术选择了本战场上一个或多个‘对它友好’的单位」没有可求值形状：冻结的 Condition
 *    没有针对“被施放牌的目标/选择计划”的谓词，ObjectFilter 的 sameLocationAs（053.3 的 here）
 *    在 layers/filter.ts 未实现，"friendly to it"（740.1.a，与法术同一控制者）也没有对应选择器；
 *    程序里以具名谓词占位记录该门槛，不伪造可求值条件。
 * 依赖：RIFT-89（cost.modify / 静态减费注册）与 RIFT-90/91（目标计划读取与 sameLocationAs 锚点）。
 */
export default {
  canonicalCardId: "card.hash-0ad8407dc26ccc74fcc0edb028e217e9d5f82966e99a5ac3e28141b11504ae5b",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处缺口，均不近似实现：(1) 没有已合入路径把 CardProgram 的 static 减费安装到被施放法术的费用计划上：" +
    "cost/cost-plan.ts 的折扣只读调用方传入的 CostDiscount，effects/instructions/ 没有 cost.modify 原语（RIFT-9 清单要求，属 RIFT-89）；" +
    "(2) 门槛「Each spell that chooses one or more units here that are friendly to it」（355.7 / 355.15 / 053.3 / 740.1.a）" +
    "需要对被施放法术最终目标计划求值的谓词，冻结的 Condition 没有该形状；ObjectFilter 的 sameLocationAs（here）在 layers/filter.ts 未实现，" +
    "\"friendly to it\" 也没有“与法术同一控制者”的选择器，程序里以具名谓词占位记录。" +
    "减费本身（少一条 [A] 级 Power 需求，135.2.e.5.a / 163.2.b）已用六域 eligible 集合表达，并由 golden 在真实费用计划上执行（1 → 0）。" +
    "依赖：RIFT-89（cost.modify 与静态减费注册）、RIFT-90/91（目标计划读取与 sameLocationAs 锚点）。",
  abilities: [
    {
      kind: "static",
      effect: {
        // 356.4.b："costs [amount] less" 是减费；作用对象是本次打出的法术费用。
        kind: "continuous.cost-modification",
        appliesTo: "play-cost",
        // "costs :rb_rune_rainbow: less"：减一条 Power 需求（135.2.e.5.a 的 [A] 可由任意域 Power 支付，
        // 故 eligible 域集合是全部六域；封闭 Domain 集合没有 Universal Power 值）。
        resource: "power",
        amount: { kind: "constant", value: -1 },
        domains: ["Fury", "Calm", "Mind", "Body", "Chaos", "Order"],
        filter: { type: "spell" }
      },
      // “该法术选择了本战场上一个或多个对它友好的单位”这一门槛：具名谓词占位，
      // 不写成硬编码条件（见 judgeReason 的缺口 2）。
      condition: {
        kind: "expression",
        value: { kind: "constant", value: "spell-chooses-one-or-more-units-here-friendly-to-it" }
      }
    }
  ],
  sourceText:
    "Each spell that chooses one or more units here that are friendly to it costs :rb_rune_rainbow: less."
} satisfies CardProgram;

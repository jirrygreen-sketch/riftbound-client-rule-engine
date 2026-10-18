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
 * 当前缺口以 judgeReason 为准；已合入的原语与通用适配不再列为缺失。
 */
export default {
  canonicalCardId: "card.hash-0ad8407dc26ccc74fcc0edb028e217e9d5f82966e99a5ac3e28141b11504ae5b",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "当前缺口：(1) cost.modify / buildCostPlan 的折扣与 cost/discounts/collect.ts 的静态费用收集已经合入，但 programs/statics.ts 的 layerFor 没有费用声明路由，chain/engine.ts 仍直接调用 buildCostPlan 而未调用 finalizeCostPlan；translateCost 也不接受 cost.discount 字段，不能用它绕过声明接线。(2)「法术最终选择至少一个此处且对它友好的单位」（355.7/355.15/053.3/740.1.a）没有目标集合谓词。收集器虽已接受 targets，当前只支持「法术选择费用来源自身」关系，未把目标并集提供给 testCostCondition，也没有绑定战场 here 与施法者控制的目标单位；sameLocationAs 的来源位置匹配已经存在，不能再列为完全缺失。原始具名条件会被严格费用收集器拒绝，不能当成恒真；少一条 [A] 的折扣已有真实计划证据。不近似实现。",
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

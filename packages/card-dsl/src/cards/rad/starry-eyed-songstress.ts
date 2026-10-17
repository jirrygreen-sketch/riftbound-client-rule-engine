import type { CardProgram } from "../../ir/index.js";

/**
 * Starry-Eyed Songstress (rad-151-167 / rad-174-167) — Legend, Mind/Order, tag Seraphine.
 *
 * sourceText（packages/card-data/data/deck-catalog.json rad-151-167，逐字）：
 *   "As an additional cost to play a spell, you may exhaust me and three friendly
 *    units to reduce the cost of that spell by :rb_energy_2:."
 *
 * 规则依据（CR v1.5）：
 * - 356.2.b / 356.2.b.1：Optional Additional Costs 由“被打出的牌或另一张牌上的被动
 *   能力”提供，措辞是 “as an additional cost” + “may”；玩家在费用流程的步骤 2 决定
 *   是否支付，204.2 / 204.2.a 要求附加费用付清才能 finalize 该牌。本卡的提供者是这张
 *   传奇上的被动能力，所以按 static（Passive Ability，363）建模。
 * - 356.4 / 356.4.f：“reduce the cost of that spell by :rb_energy_2:” 是 Discount，
 *   且减费可以作用于附加费用；本卡固定减 2 Energy，没有印刷最低值。
 * - 415.4 / 415.5：“exhaust me” 是费用式横置，必须能完成；415.1.b 规定已横置的对象
 *   不能被再次横置，因此费用式横置不能用 effect.exhaust 的状态改变代替。
 * - 355.10.c.1 / 355.7：“[do X] to [do Y]” 里作为代价的“三个友方单位”属于费用，
 *   不产生目标，因此用非目标选择（PickSpec 形状）描述，而不是 TargetSpec。
 * - 107.4.c / 108.3：“me” 是 Legend Zone 里的这张传奇（Game Object）。
 *
 * status = judge-required：整张卡没有可执行路径，不做近似实现（2026-10-17 逐条实测）——
 * - cost.modify / cost.pay 原语（effects/instructions/）已合入，且能表达同一条费用故事：
 *   cost.modify 的 optionalAdditional（356.2.b.1）+ modifier reduce（356.4.c）实测把
 *   "可选横置我"与 -2 Energy 一起算进同一份 finalized CostPlan（并链接 exhaust 动作）。缺的是从这张卡的
 *   static 到该计划的消费方：programs/statics.ts 的 staticTarget 先拒 appliesTo
 *   "play-spell-cost"（实测 "Unsupported static appliesTo ..."），把 appliesTo 换成可绑定的
 *   "self" 后 layerFor 又拒 cost.modify（实测 "Static ability kind cost.modify has no layer
 *   mapping"）；cost/cost-plan.ts 只应用调用方显式传入的 CostPlanInput.discounts/optionalAdditional，
 *   没有读取卡牌 static 的入口，也没有"费用流程步骤 2 的声明"与"已支付该附加费"的判定链。
 * - "exhaust me" 是费用式横置（CR 415.4 / 415.5）：横置必须可完成，且 "me" 是
 *   Legend Zone 里的传奇（CR 107.4.c / 355.9.a.4）。契约 ZoneId 没有 legend-zone，
 *   LocationRef 也只有 base/battlefield，无法把这件传奇作为可横置的费用对象表达。
 * 下面的 static 只保留可审查的声明形状，golden 只做校验、结构断言与缺口 todo。
 */
export default {
  canonicalCardId:
    "card.hash-464b0b2dffb63bc44ee6874ec88c809233d08e06f5215125cc0ac77d4012c215",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处当前缺口，均不近似实现：" +
    "(1) 被动能力授予的可选附加费用没有可执行路径：cost.modify / cost.pay 原语已合入，" +
    "且它们的 optionalAdditional（356.2.b.1）+ modifier reduce（356.4.c）实测把这条费用故事算进同一份 " +
    "finalized CostPlan；缺的是从卡牌 static 到该计划的消费方——programs/statics.ts 的 layerFor 不映射 " +
    "cost.modify（卡牌 static 绑定实测先抛「Unsupported static appliesTo \"play-spell-cost\"」，" +
    "把 appliesTo 换成 self 后又抛「Static ability kind cost.modify has no layer mapping」），" +
    "cost/cost-plan.ts 只应用调用方显式传入的 CostPlanInput.discounts/optionalAdditional，" +
    "没有读取卡牌 static、也没有 356.2.b.1 步骤 2 声明与「已支付该附加费」判定链的入口。" +
    "(2) “exhaust me” 是费用式横置（CR 415.4 / 415.5，必须能完成），且 “me” 是 Legend Zone 里的传奇" +
    "（CR 107.4.c / 355.9.a.4）：契约 ZoneId 没有 legend-zone、LocationRef 只有 base/battlefield，" +
    "无法作为可横置的费用对象表达；“three friendly units” 按 355.10.c.1 属于费用、不产生目标，" +
    "这里只保留非目标选择形状。",
  abilities: [
    {
      kind: "static",
      effect: {
        // 363 的 Passive Ability：为“你打出的法术”提供可选附加费用与对应减费。
        // 该 kind 与 cost-modify / cost-resources 模板及 ornns-forge 等已合入卡牌
        // 一致使用；费用管线的消费方仍缺（见 judgeReason）。
        kind: "cost.modify",
        appliesTo: "play-spell-cost",
        resource: "energy",
        // 356.4.f：Discounts can reduce additional costs（固定 -2 Energy）。
        amount: -2,
        filter: { type: "spell", controller: "controller" },
        // 356.2.b.1：可选附加费用（“you may …”）。这里是待接线的声明，不是已求值语义。
        additionalCost: {
          optional: true,
          payments: [
            // “exhaust me”：Legend Zone 里的这张传奇（107.4.c）。
            { kind: "exhaust", object: "self" },
            // “and three friendly units”：费用内的非目标选择（355.10.c.1 / 355.7）。
            {
              kind: "exhaust",
              amount: 3,
              choice: {
                id: "starry-eyed-songstress.friendly-units",
                options: ["friendly-unit"],
                min: 3,
                max: 3,
                selection: "all",
                zone: "board",
                type: "unit",
                owner: "controller"
              }
            }
          ]
        }
      }
    }
  ],
  sourceText:
    "As an additional cost to play a spell, you may exhaust me and three friendly units to reduce " +
    "the cost of that spell by :rb_energy_2:."
} satisfies CardProgram;

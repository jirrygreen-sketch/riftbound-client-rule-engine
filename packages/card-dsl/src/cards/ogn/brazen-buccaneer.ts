import type { CardProgram } from "../../ir/index.js";

/**
 * Brazen Buccaneer (ogn-002-298) — Unit, Fury, Pirate/Bilgewater, energy 6, Might 5.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ogn-002-298，逐字）:
 *   "As you play me, you may discard 1 as an additional cost. If you do,
 *    reduce my cost by :rb_energy_2:."
 *
 * 规则依据（Core Rules v1.5）:
 * - 356.2.b / 356.2.b.1：可选附加费用（Optional Additional Costs）由被打卡牌或
 *   其他卡牌的 Passive Ability 指定，用 "as an additional cost" + "may" 判定；
 *   示例原文与本节文字完全一致（先声明支付意图，再在 356.2 加费、356.4 减费、
 *   357.2 支付弃牌）。
 * - 356.4 / 356.4.b：减费在总费用阶段生效（"reduce my cost by [2]"，减费量为 2）。
 * - 356.4.f.1：可选附加费用只要玩家做了支付决定即视为已支付，与实际支付金额无关；
 *   因此 "If you do" 的凭证是费用计划的 selectedAdditional，而不是弃牌动作本身。
 * - 366.2 / 366.2.a：改费类 Passive Ability 在可打出该牌的任意区域始终生效。
 *
 * 结构说明（本卡标记 judge-required，见下）:
 * - abilities[0] 声明可选附加费用本身：kind "cost.additional"（RIFT-9 原语 id），
 *   optional: true（356.2.b / 356.2.b.1 的 "may" + "as an additional cost"），
 *   stage "optional-additional"（356.2），payments 为弃 1 张手牌；弃牌选择是
 *   CostSpec.discard 的非目标 PickSpec（355.10.c），组件 id 供减费引用。
 * - abilities[1] 声明由该支付决定授予的减费：kind "cost.modify"，resource "energy"，
 *   amount 是减少量 2（与 RIFT-89 已合入的 CostDiscount.amount 同义），stage
 *   "discount"（356.4 / 356.4.b），grantedBy 指向上面那条附加费用组件，落实
 *   356.4.f.1（"If you do" 的凭证是支付决定，不是弃牌动作本身）。
 *
 * 未合入依赖（不近似实现）:
 * - cost/buildCostPlan 已能表达 optionalAdditional（含 discard 支付）与 component 绑定的
 *   discount，但仍没有 CardProgram → CostPlan 的 IR 接线（RIFT-257）：没有已合入组件把
 *   这里的 static 费用声明注册进费用计划，CostDiscount 也没有"仅在该可选附加费用被选择时
 *   才应用"的条件（356.4.f.1 的闸门）。
 * - RIFT-261 的 cost.pay / cost.modify 指令尚未合入，卡面没有可声明它们的 op。
 * 依赖：RIFT-257（卡牌程序→费用管线绑定）、RIFT-261（cost.pay / cost.modify）。
 */
const brazenBuccaneer = {
  canonicalCardId: "card.hash-da18079d11afce4cad1d799fd51de5b0219e0635613cd5a5b4a5f38e1a42aafc",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "『you may discard 1 as an additional cost. If you do, reduce my cost by [2]』是可选附加费用 + 由该费用授予的减费" +
    "（CR 356.2.b.1、356.4、356.4.f.1）：buildCostPlan 已能表达 optionalAdditional（discard 支付）与按组件绑定的减费" +
    "（本卡测试真实执行该费用计划并验证支付后总费用为 4、拒绝时保持 6），但仍缺 CardProgram → CostPlan 的绑定层（RIFT-257），" +
    "卡面的 static 费用声明不会被生产路径登记；CostDiscount 也没有『仅在该可选附加费用被选择时才应用』的条件（356.4.f.1），" +
    "卡面声明的已付凭证无法回传；RIFT-261 的 cost.pay / cost.modify 指令亦未合入。" +
    "依赖：RIFT-257（卡牌程序→费用管线绑定）、RIFT-261（cost.pay / cost.modify）。不近似实现。",
  abilities: [
    {
      kind: "static",
      effect: {
        // 356.2.b / 356.2.b.1：可选附加费用（可选性由 optional 承载）。
        kind: "cost.additional",
        id: "brazen-buccaneer.discard-cost",
        appliesTo: "self",
        optional: true,
        stage: "optional-additional",
        payments: [
          {
            kind: "discard",
            amount: { kind: "constant", value: 1 },
            choice: {
              id: "brazen-buccaneer.discard",
              options: ["card-in-controller-hand"],
              min: 1,
              max: 1,
              selection: "one"
            }
          }
        ]
      }
    },
    {
      kind: "static",
      effect: {
        // 356.4 / 356.4.b：减费。amount 是减少量（与 RIFT-89 CostDiscount.amount 同义）。
        kind: "cost.modify",
        appliesTo: "self",
        resource: "energy",
        amount: { kind: "constant", value: 2 },
        stage: "discount",
        // 356.4.f.1：该减费只在上面那条可选附加费用的支付决定成立时授予。
        grantedBy: "brazen-buccaneer.discard-cost"
      }
    }
  ],
  sourceText: "As you play me, you may discard 1 as an additional cost. If you do, reduce my cost by :rb_energy_2:."
} satisfies CardProgram;

export default brazenBuccaneer;

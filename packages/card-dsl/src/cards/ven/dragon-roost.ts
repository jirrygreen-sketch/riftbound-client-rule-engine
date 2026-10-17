import type { CardProgram } from "../../ir/index.js";

/**
 * Dragon Roost (ven-157-166) — Battlefield, Colorless.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-157-166，逐字）：
 *   "Any player may pay :rb_rune_rainbow::rb_rune_rainbow: as an additional cost to
 *    play a Dragon. If they do, they play it to this battlefield."
 *
 * 规则依据（Core Rules v1.5）：
 * - 356.2.b / 356.2.b.1："may pay … as an additional cost" 是 Optional Additional
 *   Cost，在打出流程步骤 2 决定、步骤 3 计入；355.1.a 明确“是否支付可选附加费用”
 *   就是这一步的选择。356.2.a/356.2.a.1：被动能力上的 "as an additional cost" 若不带
 *   "may" 才是强制附加费，本条带 "may"，属可选，不得按强制处理。
 * - 135.2.e.5 / 135.2.e.5.a、163.2.b：:rb_rune_rainbow: 是任意域 Power [A]，作为费用可
 *   由任意域 Power 支付；印刷的两个 [A] 是两条各 1 点的任意域 Power 需求。
 * - 355.17 / 355.17.a："If they do, they play it to this battlefield" 是附加费用支付后
 *   生效的打出位置强制要求（Mandatory Requirement）；规则 355.17.a 的
 *   Dune Drake / Dragon Roost 例子正是本条。
 * - 355.2 / 355.2.b：单位默认只能打到自己基地或自己控制的战场；本条授予的
 *   Dragon Roost 位置是额外合法位置，只在费用已付时适用。
 * - 356.4.f.1："If they do" 的凭证是玩家"决定支付"这一事实，与实付多少无关。
 *
 * status = judge-required（缺口均不近似实现）：
 * 1. 缺附加费用的生产接线：cost.pay 与 CostPlanInput.optionalAdditional 消费方已合入
 *    （cost-plan 接受调用方传入的 optionalAdditional 并记录 selected/declined），
 *    cost.additional 是尚无绑定消费方的静态声明，不是已注册指令；
 *    但 Chain Finalize 只从打出项自身成本构建 input，没有生产者把卡程序声明的附加费用与
 *    356.4.f.1 的「决定支付」选择接进 Finalize。
 * 2. 缺“[A][A] 支付后改写打出位置”的消费者：playDestinationIsLegal 已在 Finalize
 *    校验位置（355.2.b / 355.17 / 420.3.b.2），但没有把费用回执绑定成
 *    then.play-to-source-battlefield 位置强制要求的消费方。
 * 3. Dragon 的 tags 过滤已支持（133.8）；缺的是费用声明绑定到任意玩家待打出的
 *    Dragon，而非关键词或标签谓词本身。result 条件也已可读取真实附加费用决定。
 * 依赖：附加费用声明→Finalize optionalAdditional 的生产接线、费用回执→位置强制要求
 * 绑定（同 sfd/dauntless-vanguard、ogn/deadbloom-predator 的缺口）。
 */
export default {
  canonicalCardId: "card.hash-3c9c1ccb78aab17f295eb8db5ff0c0e32b4b941002aaf23a31a6d820c6a0193a",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口，均不近似实现：(1) 缺可选附加费用的声明接线——cost.additional 是静态声明，生产 binder 直接拒绝" +
    "（实测 'Static ability kind cost.additional has no layer mapping'，被 attachLifecycle 的 onError 吞掉，fail-closed）；cost.pay 与 " +
    "CostPlanInput.optionalAdditional 消费方已合入，但 Chain Finalize 只从打出项自身成本构建 input，" +
    "没有生产者把卡程序声明的附加费用与 356.4.f.1 的「决定支付」回执接进 Finalize；" +
    "(2) 缺「[A][A] 已付则打到本战场」的消费者：playDestinationIsLegal 已在 Finalize 校验位置" +
    "（355.2/355.2.b/355.17/355.17.a 与 420.3.b.2），但没有把费用回执绑定成 then.play-to-source-battlefield " +
    "位置强制要求的消费方；" +
    "(3) Dragon 的 tags 谓词已支持（133.8），仍缺把该静态声明绑定到任意玩家待打出对象的上下文。" +
    "result 条件已可读取真实附加费用决定，缺该决定到位置要求的生产绑定。附费的两个 [A] 已按 135.2.e.5.a/163.2.b 记录成" +
    "两条任意域 Power 需求（六域 eligible 集合）。依赖：附加费用声明→optionalAdditional 的生产接线、" +
    "打出位置许可的 Finalize 消费者。不近似实现，不把可选附加费写成强制费。",
  abilities: [
    {
      kind: "static",
      // 356.2.b.1：被动能力规定的可选附加费用 + 费用支付后的位置强制要求。
      // 该连续效果是费用/位置管线的输入形状；effects/instructions 没有对应原语，
      // layers 也没有 play-location-permission 的读取方（见 judgeReason）。
      effect: {
        kind: "cost.additional",
        id: "dragon-roost.additional-cost",
        optional: true,
        stage: "optional-additional",
        // "a Dragon"：133.8 的印刷 tag 谓词；对象域由调用方提供，
        // 卡程序不能自行枚举任何玩家手牌中的 Dragon（见 judgeReason 缺口 3）。
        filter: { type: "unit", tags: ["Dragon"] },
        payments: [
          {
            // 135.2.e.5 / 135.2.e.5.a：每个 :rb_rune_rainbow: 是 1 点可由任意域 Power 支付的 [A]；
            // 封闭六域集合没有 Universal Power 值，故用全六域 eligible 集合。
            kind: "power",
            amount: { kind: "constant", value: 1 },
            allowedDomains: ["Fury", "Calm", "Mind", "Body", "Chaos", "Order"]
          },
          {
            // 印刷的两个 [A] 是两条各 1 点的 Power 需求，不是一个 2 点需求。
            kind: "power",
            amount: { kind: "constant", value: 1 },
            allowedDomains: ["Fury", "Calm", "Mind", "Body", "Chaos", "Order"]
          }
        ],
        // "If they do, they play it to this battlefield"：355.17/355.17.a 的强制要求，
        // 只在 356.4.f.1 的费用凭证成立时生效；缺少费用回执到本位置要求的绑定。
        then: {
          kind: "play-to-source-battlefield",
          requirement: "mandatory",
          paidGate: "optional-additional"
        }
      }
    }
  ],
  sourceText:
    "Any player may pay :rb_rune_rainbow::rb_rune_rainbow: as an additional cost to play a Dragon. " +
    "If they do, they play it to this battlefield."
} satisfies CardProgram;

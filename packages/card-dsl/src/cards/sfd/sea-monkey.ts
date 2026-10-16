import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Sea Monkey (sfd-098-221) — Unit, 2 energy, 无印刷 Power, Might 2，
 * 领域 Body，标签 Pirate / Bilgewater。
 *
 * sourceText（packages/card-data/data/deck-catalog.json sfd-098-221，逐字）：
 *   "You may pay :rb_energy_1: as an additional cost to play me.
 *    When you play me, if you paid the additional cost, buff me. (Give me a +1
 *    :rb_might: buff if I don't already have one.)"
 *
 * 规则依据（Core Rules v1.5）：
 * - 356.2.b / 356.2.b.1："You may pay … as an additional cost" 是 Optional Additional Cost，
 *   由被打出牌上的 Passive Ability 给出，是否支付在打出流程第 2 步（355.1.a）由控制者声明；
 *   额外的 1 Energy 在 356.2 施加。
 * - 356.4.f.1：可选附加费用「已支付」的判定只看玩家是否做出支付决定，不看实际支付细节。
 * - 383.4.a / 420.4.a："When you play me" 是 Play Effect（时点 card-played）；"if you paid
 *   the additional cost" 直接引用该支付决定（359.3.e.14.b 的「直接引用该动作结果」口径），
 *   因此它是第二条能力的适用条件，而不是一条可自行结算的指令。
 * - 702.2.a / 702.3 / 702.3.a："buff me" 放置一个 Buff，已有 Buff 时不放置第二个；括号内是
 *   reminder（703 的 +1 Might 由图层从 Buff 计数派生），不是独立指令。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required，两处缺口都不近似实现。
 * - 可选附加费用没有收费入口：effects/instructions/ 里没有 cost.additional / cost.pay 原语，
 *   cost/cost-plan.ts 的 optionalAdditional 只接受调用方传入的 OptionalCostInput，没有任何代码
 *   把 CardProgram 声明的附加费用接进 buildCostPlan（RIFT-89）。第 1 条因此以描述性的 static
 *   cost.additional 形状保留，而不是把它写成结算期 effect.resources（那会把费用变成效果）。
 * - "if you paid the additional cost" 没有可绑定的支付回执：冻结 IR 的 Condition 只有
 *   always/never/compare/all/any/not/expression，没有读取费用计划结果的来源（调研记为
 *   condition.result），也没有把 356.4.f.1 的 paid 决定写入链接值的路径。第 2 条因此保留
 *   target + effect.buff 的可审查形状，但**不**伪造一个恒真的 condition 来开闸。
 * 依赖：RIFT-89（cost.additional / 费用计划接线与支付回执）。
 */
const abilities: Ability[] = [
  {
    // 356.2.b / 356.2.b.1：被打出牌上的 Optional Additional Cost。支付的 1 Energy 是费用
    // 分量（355.10.c 的费用内选择不构成目标），不是结算期效果。
    kind: "static",
    effect: {
      kind: "cost.additional",
      id: "sea-monkey.additional-cost",
      appliesTo: "self",
      optional: true,
      stage: "optional-additional",
      payments: [
        {
          kind: "energy",
          amount: { kind: "constant", value: 1 }
        }
      ]
    }
  },
  {
    kind: "triggered",
    trigger: {
      at: "card-played",
      filter: { event: "card-played", filter: { source: "self" } }
    },
    optional: false,
    body: [
      {
        id: "sea-monkey.buff-me",
        op: "effect.buff",
        args: {
          mode: { kind: "constant", value: "buff" },
          target: { kind: "constant", value: "sea-monkey.self" }
        },
        targets: [
          {
            id: "sea-monkey.self",
            // 355.10.d.1："me" 由特征程序化选中、从不做选择；契约 3.6 的 "self" 锚点由解释器
            // 在运行时绑定宿主。
            filter: { object: "self", type: "unit", zone: "board" },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-8b94882b556c55cce216445bf3c9f8b69b9e4c725571f25e890a951c67bb05c6",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "两处缺口：(1)「You may pay :rb_energy_1: as an additional cost to play me」是 356.2.b/356.2.b.1 的" +
    "可选附加费用，但没有收费入口——effects/instructions/ 无 cost.additional / cost.pay 原语，" +
    "cost/cost-plan.ts 的 optionalAdditional 只消费调用方传入的 OptionalCostInput，没有代码把 CardProgram " +
    "声明的费用接进 buildCostPlan（RIFT-89）；本卡以描述性 static cost.additional 保留形状，" +
    "不把它写成结算期 effect.resources（那会把费用变成效果）。" +
    "(2)「if you paid the additional cost」没有可绑定的支付回执：356.4.f.1 只看玩家是否做出支付决定，" +
    "而冻结 Condition（always/never/compare/all/any/not/expression）没有读取费用计划结果的来源" +
    "（调研记为 condition.result），也没有把该决定写入链接值的路径，故不伪造恒真条件开闸。" +
    "effect.buff 本体已合入（702.2.a/702.3.a），golden 用真实原语执行 buff 与「已有 buff 不再放置」边界。" +
    "依赖：RIFT-89（cost.additional / 费用计划接线与支付回执）。",
  abilities,
  sourceText:
    "You may pay :rb_energy_1: as an additional cost to play me.\n" +
    "When you play me, if you paid the additional cost, buff me. (Give me a +1 :rb_might: buff if I don't already have one.)"
} satisfies CardProgram;

export default program;

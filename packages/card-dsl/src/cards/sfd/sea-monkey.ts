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
 * status 判定（cards/README.md 第 2 节）：judge-required（复核 2026-10-17）。
 * RIFT-261（cost.pay / cost.modify 与费用种类）已合入，RIFT-359 也已提供 356.4.f.1 的
 * result 谓词；三处当前缺口均不近似实现：
 * - 可选附加费用没有卡牌侧收费入口：cost/cost-plan.ts 的 optionalAdditional 只接受调用方
 *   传入的 OptionalCostInput，programs/play.ts 的 translateCost 对 additional / additional-cost
 *   字段直接判 judge-required（实测 "Additional costs are not bound"），对 optional 字段抛
 *   "Unsupported play cost field optional"，createEngineStaticBinder.bindStatic 对该 effect kind 抛
 *   "Static ability kind cost.additional has no layer mapping"；第 1 条因此以 static
 *   cost.additional 形状保留，而不是写成结算期 effect.resources（那会把费用变成效果）。
 * - "if you paid the additional cost" 的谓词本身已合入（RIFT-359 的 Condition kind "result"，
 *   effects/interpreter/predicates/result.ts 从 { plan, receipt } 读取支付决定，本卡已按该词汇写
 *   TriggerSpec.condition）；仍缺的是打出流程把被打出牌的 item.payment 回执送进该 card-played
 *   触发的 Resolve 输入，真实波次因此抛 MissingInformation（同 sfd/zaun-punk）。
 * - 能力体在合并的 CardProgram 绑定里也仍不可绑定：body target 的 `object: "self"` 锚点被
 *   programs/filters.ts 的 translateObjectFilter 以 "Unsupported filter field object" 拒绝，
 *   layers/filter.ts 的 matchesObjectFilter 也不消费 OBJECT_FILTER_ANCHORS 的 self 锚点。
 * 依赖：CardProgram → CostPlanInput 的附加费用消费方、card-played 触发的费用回执投递，
 * 以及过滤器适配对 self 锚点（OBJECT_FILTER_ANCHORS）的消费。
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
      filter: { event: "card-played", filter: { source: "self" } },
      // 383.2.a.1 + 356.4.f.1："if you paid the additional cost" 是触发条件的一部分；
      // result 谓词读取 finalized { plan, receipt } 的支付决定（与实付量无关）。
      condition: { kind: "result", result: "additional-cost-paid", id: "sea-monkey.additional-cost" }
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
    "RIFT-261 与 RIFT-359 已合入，三处当前缺口均不近似实现：" +
    "(1)「You may pay :rb_energy_1: as an additional cost to play me」是 356.2.b/356.2.b.1 的可选附加费用，" +
    "但没有卡牌侧收费入口——cost/cost-plan.ts 的 optionalAdditional 只消费调用方传入的 OptionalCostInput，" +
    "programs/play.ts 的 translateCost 对 additional / additional-cost 字段抛 \"Additional costs are not bound\"、对 optional 字段抛 \"Unsupported play cost field optional\"，" +
    "createEngineStaticBinder.bindStatic 对该 effect kind 抛 \"Static ability kind cost.additional has no layer mapping\"；" +
    "没有代码把 CardProgram 声明的附加费用接进 buildCostPlan；本卡以描述性 static cost.additional 保留形状，" +
    "不把它写成结算期 effect.resources（那会把费用变成效果）。" +
    "(2)「if you paid the additional cost」的 356.4.f.1 谓词已合入（RIFT-359 的 Condition kind \"result\"），" +
    "本卡据此写 TriggerSpec.condition，golden 用真实 buildCostPlan/payCostPlan 回执执行已付/未付两支；" +
    "仍缺的是打出流程把被打出牌的 item.payment 回执送进该 card-played 触发的 Resolve 输入，真实波次抛 MissingInformation（同 sfd/zaun-punk）。" +
    "(3) 能力体在合并的 CardProgram 绑定里仍不可绑定：body target 的 object: \"self\" 锚点被 programs/filters.ts 的 " +
    "translateObjectFilter 以 \"Unsupported filter field object\" 拒绝，layers/filter.ts 的 matchesObjectFilter 也不消费 OBJECT_FILTER_ANCHORS 的 self 锚点。" +
    "effect.buff 本体已合入（702.2.a/702.3.a），golden 用真实原语执行 buff 与「已有 buff 不再放置」边界。" +
    "依赖：CardProgram → CostPlanInput 的附加费用消费方、card-played 触发的费用回执投递、过滤器适配对 self 锚点的消费。",
  abilities,
  sourceText:
    "You may pay :rb_energy_1: as an additional cost to play me.\n" +
    "When you play me, if you paid the additional cost, buff me. (Give me a +1 :rb_might: buff if I don't already have one.)"
} satisfies CardProgram;

export default program;

import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Frostcoat Cub (sfd-067-221) — Unit, Mind, Dog/Freljord.
 * energy 3, power: none printed, Might 3.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, sfd-067-221，逐字）:
 *   "You may pay :rb_rune_mind: as an additional cost to play me.\n"
 *   "When you play me, if you paid the additional cost, give a unit -2 :rb_might: this turn."
 *
 * 规则依据（CR v1.5）:
 * - "You may pay :rb_rune_mind: as an additional cost to play me"：356.2.b/356.2.b.1 的
 *   Optional Additional Cost（由被打出卡自身的 Passive Ability 规定，含 "may"，在 355.1.a 的
 *   选择步骤决定、356.2 施加）。:rb_rune_mind: 是 135.2.e.4 的具名域 Power 费用，本卡域为 Mind
 *   （能量费以外的 1 Mind Power 由印刷费用承担；两处都不改写为 0）。
 * - "When you play me"（383.4.a/420.4.a）：Play Effect，时点 card-played，{ source: "self" }。
 * - "if you paid the additional cost"：356.4.f.1 规定「支付」以玩家的支付决定为凭证，与实付量无关；
 *   这是 359.3.e.14.b 的直接引用游戏动作型条件。
 * - "give a unit -2 :rb_might: this turn"：临时 Might 修正，属算术图层（143.2.a、475–478）；
 *   effect.buff 文件头明确临时 Might 修改归 continuous.might，绝不能写成 Buff 计数（702/703）。
 *   "a unit" 未限定友敌，是结算时可选的单位（355.9.b 的对象选择）。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required（复核 2026-10-17），两处当前缺口：
 * - 可选追加费用没有卡牌侧入口：merged cost 计划能支付 power 组件（golden 以调用方传入的
 *   mandatoryAdditional 作孤立证据），但没有任何已合入消费方把 CardProgram 声明的 static
 *   cost.additional 接进 CostPlanInput——programs/play.ts 的 translateCost 对
 *   additional / additional-cost 与 optional 字段直接判 judge-required，
 *   createEngineStaticBinder.bindStatic 对该 effect kind 抛
 *   "Static ability kind cost.additional has no layer mapping"。
 * - 「if you paid the additional cost」的谓词已合入（RIFT-359 的 Condition kind "result"，
 *   由 effects/interpreter/predicates/result.ts 从 { plan, receipt } 读取 356.4.f.1 的支付决定），
 *   本卡按该词汇写 TriggerSpec.condition；仍缺的是打出流程把被打出牌的 item.payment 回执送进
 *   该 card-played 触发的 Resolve 输入，真实波次因此抛 MissingInformation（同 sfd/zaun-punk）。
 * 「give a unit -2 :rb_might: this turn」半段已可执行：continuous.might 注册
 * arithmetic 层修正并按回合末到期，golden 经生产链适配器真实执行（含目标失效 ignored）。
 * 依赖：CardProgram → CostPlanInput 的可选追加费用消费方与 card-played 触发的费用回执投递。
 */
const abilities: Ability[] = [
  {
    // 356.2.b/356.2.b.1：由本卡 Passive Ability 规定的 Optional Additional Cost。
    // 支付组件用已合入 cost/plan-values.ts 的词汇声明（power + allowedDomains），
    // 但没有任何代码把卡牌程序声明的费用接进计划（见 judgeReason）。
    kind: "static",
    effect: {
      kind: "cost.additional",
      id: "frostcoat-cub.additional-cost",
      appliesTo: "self",
      optional: true,
      stage: "optional-additional",
      payments: [
        {
          kind: "power",
          amount: { kind: "constant", value: 1 },
          allowedDomains: ["Mind"]
        }
      ]
    }
  },
  {
    kind: "triggered",
    trigger: {
      at: "card-played",
      filter: { event: "card-played", filter: { source: "self" } },
      // 383.2.a.1 + 356.4.f.1：「if you paid the additional cost」紧跟在触发条件之后，
      // 是触发条件的一部分；已合入的 result 谓词按支付决定（与实付量无关）开闸。
      condition: { kind: "result", result: "additional-cost-paid", id: "frostcoat-cub.additional-cost" }
    },
    optional: false,
    body: [
      {
        // 门控在触发条件上（见上）；指令本身不带条件，也不把费用改写成效果。
        id: "frostcoat-cub.give-minus-2-might",
        op: "continuous.might",
        args: {
          amount: { kind: "constant", value: -2 },
          duration: { kind: "constant", value: "this-turn" },
          // 契约 3.6：作用对象经 objects 描述符指向 Finalize 锁定的 TargetSpec；
          // 缺省选择是来源自身（霜甲幼崽本体），不是卡面的 "a unit"。
          objects: {
            kind: "constant",
            value: { kind: "target", id: "frostcoat-cub.unit" }
          }
        },
        targets: [
          {
            id: "frostcoat-cub.unit",
            filter: { type: "unit", zone: "board" },
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
  canonicalCardId: "card.hash-868962f51f93e867b6166a5b00e7da34767ced7692925eb143855d3d05c68618",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "两处当前缺口，均不近似实现：(1)「You may pay :rb_rune_mind: as an additional cost to play me」（356.2.b/356.2.b.1，355.1.a 选择、356.2 施加）" +
    "没有卡牌侧入口：merged cost 计划能支付 power 组件（golden 以调用方传入的 mandatoryAdditional 作孤立证据），" +
    "但没有任何已合入消费方把 CardProgram 声明的 static cost.additional 接进 CostPlanInput——" +
    "programs/play.ts 的 translateCost 对 additional 字段抛 \"Additional costs are not bound\"、对 optional 字段抛 \"Unsupported play cost field optional\"，" +
    "createEngineStaticBinder.bindStatic 对该 effect kind 抛 \"Static ability kind cost.additional has no layer mapping\"。" +
    "(2)「if you paid the additional cost」的 356.4.f.1 谓词已合入（RIFT-359 的 Condition kind \"result\"，" +
    "effects/interpreter/predicates/result.ts 从 { plan, receipt } 读取支付决定），本卡按该词汇写 TriggerSpec.condition；" +
    "仍缺的是打出流程把被打出牌的 item.payment 回执送进该 card-played 触发的 Resolve 输入，真实波次因此抛 MissingInformation（同 sfd/zaun-punk）。" +
    "「give a unit -2 :rb_might: this turn」半段已可执行：continuous.might 注册 arithmetic 层修正并回合末到期，" +
    "golden 已用生产链适配器真实执行（含目标失效 ignored），并用真实的 buildCostPlan/payCostPlan 回执执行 result 谓词的已付/未付两支；" +
    "绝不用 effect.buff 计数近似（702/703）。" +
    "依赖：CardProgram → CostPlanInput 的可选追加费用消费方与 card-played 触发的费用回执投递。",
  abilities,
  sourceText:
    "You may pay :rb_rune_mind: as an additional cost to play me.\n" +
    "When you play me, if you paid the additional cost, give a unit -2 :rb_might: this turn."
} satisfies CardProgram;

export default program;

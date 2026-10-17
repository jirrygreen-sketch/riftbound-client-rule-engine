import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Udyr, Wildman (ogn-157-298) — Unit（能量 6，力量 1，Might 6，Body；Udyr/Freljord/Champion）。
 *
 * 原文：
 *   Spend my buff: Choose one you've not chosen this turn —
 *   Deal 2 to a unit at a battlefield. Stun a unit at a battlefield. Ready me.
 *   Give me [Ganking] this turn.
 *
 * 规则依据（CR v1.5）：
 * - 377.1 / 204.1.b："Spend my buff:" 是启动能力的 Base Cost（冒号前的费用）；
 *   702.2.b 的 spend a buff 是受限动作，cost/README.md 已支持
 *   `payments[{kind: "spend-buff", object: "self", amount}]` 的费用形态。
 * - 381 / 381.1：未标注速度的启动能力只能在控制者 Main Phase 的 Open State 启动，
 *   故 timing 为 "action"。
 * - 355.5.a / 355.6："Choose one…" 是结算/进链时的模式选择，用 choice.mode
 *   （contract 3.9：count 1、different true；模式各自带 body）。
 * - 418.1/418.1.e："Deal 2 to a unit at a battlefield" 是固定 2 点伤害（不涉及分摊）。
 * - 424：Stun 是状态；effect.stun 已是合入原语（"a unit at a battlefield" 用
 *   location 过滤）。
 * - 416.1/416.2："Ready me" 用 effect.ready 的 source 选择。
 * - 801.3.a："Give me [Ganking] this turn" 是限时关键词授予（Granted Keyword，
 *   810 的 Ganking 权限），需要限时持续效果而非直接改写特征。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required。复核 2026-10-17：
 * - "Choose one you've not chosen this turn" 需要跨多次启动的本回合选择记忆
 *   （383.1.b 式的"第 N 次"语义与选择账本）；choice.mode 只在**本次结算内**
 *   保证 different（count/different），没有跨启动的"本回合未选过"过滤，同一次启动也
 *   无法读取历史选择。审查还发现 chain/engine.ts 的 assertFinalizationSurface 直接
 *   拒绝 choice.mode（Mode choices require a Finalize/Resolve choice-plan adapter），
 *   生产链路径本身还不能结算该指令。
 * - "Give me [Ganking] this turn" 已由 continuous.grant-keyword 真实执行：
 *   golden 经链式适配器 + 图层引擎断言 ability 层注册、关键词 Ganking 与
 *   end-of-turn 到期；layers/rules/query.ts 与 zones/movement.ts 现在会消费
 *   该 movement 许可来判定 battlefield-to-battlefield 的 Standard Move。
 * - "Spend my buff:"（702.2.b 的 spend-buff）已用费用计划真实收取（golden）。
 * - "a unit at a battlefield" 的伤害/横置目标在真实链路里可用 TargetSpec 表达，
 *   对应模式的 effect.damage / effect.stun / effect.ready 已由 golden 真实执行。
 * 依赖：模式选择记忆账本、choice.mode 的 Finalize/Resolve choice-plan adapter、
 * Ganking 移动许可消费方（Standard Move 合法性检查）。
 * 不近似实现（不把"本回合未选过"删掉当无限制，也不写死伤害数额）。
 */
const abilities: Ability[] = [
  {
    kind: "activated",
    cost: {
      payments: [
        {
          kind: "spend-buff",
          object: "self",
          amount: { kind: "constant", value: 1 }
        }
      ]
    },
    timing: "action",
    body: [
      {
        id: "udyr.choose-mode",
        op: "choice.mode",
        args: {
          count: { kind: "constant", value: 1 },
          different: { kind: "constant", value: true },
          modes: {
            kind: "constant",
            value: [
              {
                id: "udyr.damage-mode",
                body: [
                  {
                    id: "udyr.deal-2",
                    op: "effect.damage",
                    args: {
                      amount: { kind: "constant", value: 2 },
                      target: { kind: "constant", value: "udyr.damage-target" }
                    },
                    targets: [
                      {
                        id: "udyr.damage-target",
                        filter: { type: "unit", location: { type: "battlefield" } },
                        min: 1,
                        max: 1,
                        selection: "one"
                      }
                    ]
                  }
                ]
              },
              {
                id: "udyr.stun-mode",
                body: [
                  {
                    id: "udyr.stun-unit",
                    op: "effect.stun",
                    args: { target: { kind: "constant", value: "udyr.stun-target" } },
                    targets: [
                      {
                        id: "udyr.stun-target",
                        filter: { type: "unit", location: { type: "battlefield" } },
                        min: 1,
                        max: 1,
                        selection: "one"
                      }
                    ]
                  }
                ]
              },
              {
                id: "udyr.ready-mode",
                body: [
                  {
                    id: "udyr.ready-self",
                    op: "effect.ready",
                    args: { objects: { kind: "constant", value: { kind: "source" } } }
                  }
                ]
              },
              {
                id: "udyr.ganking-mode",
                body: [
                  {
                    id: "udyr.grant-ganking",
                    op: "continuous.grant-keyword",
                    args: {
                      keyword: { kind: "constant", value: "Ganking" },
                      duration: { kind: "constant", value: "end-of-turn" },
                      objects: { kind: "constant", value: { kind: "source" } }
                    }
                  }
                ]
              }
            ]
          }
        }
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-fa80adfa87e517c318ff696460904b28aeb38024b68666372f0109ecf2757882",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "一处模式接线缺口（复核 2026-10-17）：“Choose one you've not chosen this turn” 需要跨启动的本回合选择记忆" +
    "——choice.mode 只在本次结算内做 count/different 去重，没有跨结算读取本回合已选模式的账本（383.1.b 系列对“第 N 次”的裁决）；" +
    "并且 chain/engine.ts 的 assertFinalizationSurface 直接拒绝 choice.mode（Mode choices require a Finalize/Resolve choice-plan adapter），" +
    "生产链路径无法结算该指令。continuous.grant-keyword、Ganking 的 movement 查询与 Standard Move 合法性消费均已接通。" +
    "已真实执行：spend-buff 费用（702.2.b，费用计划）、effect.damage / effect.stun / effect.ready 三个模式，以及 Ganking 的限时授予。" +
    "依赖：跨启动的选择记忆账本、choice.mode 的 Finalize/Resolve choice-plan adapter。不近似实现。",
  abilities,
  sourceText:
    // 逐字保留 catalog 原文：四个模式之间只有 "."、没有空格或换行（数据疑点已上报，未修改）。
    "Spend my buff: Choose one you've not chosen this turn —\n" +
    "Deal 2 to a unit at a battlefield.Stun a unit at a battlefield.Ready me.Give me [Ganking] this turn."
} satisfies CardProgram;

export default program;

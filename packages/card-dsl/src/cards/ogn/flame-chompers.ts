import type { CardProgram } from "../../ir/index.js";

/**
 * Flame Chompers (ogn-006-298) — Unit, Fury, Zaun, energy 3, Might 3.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ogn-006-298，逐字）:
 *   "When you discard me, you may pay :rb_rune_fury: to play me."
 *
 * 规则依据（Core Rules v1.5）:
 * - 423.1.b："When I am discarded" 是弃牌动作后的触发能力；对应已合入时点
 *   card-discarded（events/timing-points.ts，ruleRefs 423.1/423.1.b/423.3/423.4）。
 * - 383.2.c.1 / 385.1 / 385.2：弃牌后的触发需要在 Trash 注册，并绑定换区后的
 *   incarnation；不能沿用永久卡默认的 Board 活跃区域。
 * - 383.3.a / 383.3.b / 383.3.b.1：首段 "you may pay ... to ..." 的选择和费用
 *   属于触发能力的 Finalize；不能推迟到 choice.optional 或 resulting Play 结算。
 * - 420.3 / 420.3.a：效果导致的打出按正常打出流程处理（Limited Action）并开链；
 *   420.1.a 的默认规则只允许从手牌 / 冠军区打出。366.1 是被动能力的场外上下文，
 *   不是本卡触发能力缺少的独立区域许可。
 * - 357：:rb_rune_fury: 是 1 Fury Power；费用计划与支付原语已经支持。
 *
 * 受阻草案（不作为完整规则实现）:
 * - triggered + choice.optional（契约 3.9：被选指令包进 body）：接受后由 effect.play
 *   打出仍在 Trash 的本卡。现有 finalized 1 Fury Power 覆盖只提供嵌套 Play 的
 *   费用计划形状，不能代替 383.3.b 要求的触发能力首段费用，也不能据此把
 *   "pay ... to play" 当作 356.1.a 的 "for [Cost]"。省略 energy 不改变印刷值。
 * - effect.play 的 TargetSpec 用 { source: "self" } 锚点（IR 静态数据用契约 3.6 的
 *   符号选择器，不写运行时 ObjectRef）选择仍在 Trash 的本卡。
 * - effect.play 已支持 finalized cost override，chain/engine.ts 会将其接入费用计划；
 *   该接口不再是缺口。测试内核可证明费用计划与支付回执，不证明 Power 扣除。
 *
 * 未完成部分（不近似实现）:
 * - 绑定器当前拒绝 effect.play 的 self/source Trash 目标过滤，无法把接受分支
 *   绑定到仍在 Trash 的本卡。
 * - programs/triggers.ts 对 card-discarded 默认 activeZones=['board']，lifecycle
 *   只在进 Chain / Board 时注册；缺 Hand → Trash 后的触发注册和 incarnation 绑定。
 * - TriggeredAbility 没有首段费用字段，绑定器也未产出 TriggerRegistration.cost /
 *   mayAtFinalize；单独的费用计划、支付回执与拒绝分支均不证明这些流程已执行。
 */
const flameChompers = {
  canonicalCardId: "card.hash-0f5f84f75dbe0744c93412016da28963e78fa05c747a4b3163be7cfef5f26cc9",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺弃牌后的 Trash 触发注册与换区 incarnation 绑定（CR 423.1.b、383.2.c.1、385.1/385.2）：" +
    "programs/triggers.ts 对 card-discarded 默认 activeZones=['board']，programs/lifecycle.ts 只在进 Chain/Board 时注册，" +
    "首段『you may pay :rb_rune_fury: to play me』还缺触发能力 Finalize 的选择与 Fury 基础费用绑定" +
    "（383.3.a、383.3.b/383.3.b.1）；TriggeredAbility 无费用字段，绑定器未产出 TriggerRegistration.cost/mayAtFinalize，" +
    "choice.optional 与 resulting effect.play 的费用覆盖不能替代该流程。" +
    "当前草案另有 programs/filters.ts 拒绝 effect.play 的 self/source Trash 目标过滤及嵌套目标生命周期绑定缺口；" +
    "cost.pay 和 finalized cost override 已合入，单独的计划/回执与 Play 子效果不证明整卡可执行。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "card-discarded",
        filter: { event: "card-discarded", filter: { source: "self" } }
      },
      optional: true,
      body: [
        {
          id: "flame-chompers.opt-in",
          op: "choice.optional",
          args: {
            prompt: { kind: "constant", value: "Pay :rb_rune_fury: to play Flame Chompers from your trash?" },
            body: {
              kind: "constant",
              value: [
                {
                  id: "flame-chompers.play",
                  op: "effect.play",
                  args: {
                    target: { kind: "constant", value: "flame-chompers.self" },
                    cost: { kind: "constant", value: { finalized: true, power: ["Fury"] } },
                    location: { kind: "constant", value: { type: "base", player: "controller" } }
                  },
                  targets: [
                    {
                      id: "flame-chompers.self",
                      filter: { source: "self", zone: "trash" },
                      min: 1,
                      max: 1,
                      selection: "one"
                    }
                  ]
                }
              ]
            }
          }
        }
      ]
    }
  ],
  sourceText: "When you discard me, you may pay :rb_rune_fury: to play me."
} satisfies CardProgram;

export default flameChompers;

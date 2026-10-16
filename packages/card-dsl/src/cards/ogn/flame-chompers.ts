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
 * - 355.10.c / 355.9："you may" 是可选执行（choice.optional，契约 3.9：把被选指令
 *   包进 body，不用 choice + linkedTo）。
 * - 420.3 / 420.3.a：效果导致的打出按正常打出流程处理（Limited Action）并开链；
 *   420.1.a 的默认规则只允许从手牌 / 冠军区打出，因此从 Trash 打出需要本能力
 *   自身的许可（366.1）。
 * - 356.2 / 357：支付 :rb_rune_fury:（1 Fury Power）是该可选动作的费用。
 *
 * 结构说明:
 * - triggered + choice.optional（契约 3.9：被选指令包进 body）：接受后由 effect.play
 *   打出仍在 Trash 的本卡，费用用 356.1.a 的"for [Cost]"改写写成已 Finalize 的费用
 *   计划（只声明 1 Fury Power；不写 energy 组件，避免把"没有印刷费用"表达成 0）。
 * - effect.play 的 TargetSpec 用 { source: "self" } 锚点（IR 静态数据用契约 3.6 的
 *   符号选择器，不写运行时 ObjectRef）选择仍在 Trash 的本卡。
 *
 * 未合入依赖（不近似实现）:
 * - effects/instructions/ 没有 cost.pay / cost.printed 原语，也没有卡牌程序 → 费用计划
 *   的接线（RIFT-89）：卡面只声明已 Finalize 的计划形状，真正的替代费用计算与
 *   Power 支付（356.1.a / 357.2）没有消费方，参考内核的 pay 也只校验 energy/xp。
 * - 从 Trash 打出所需的许可/限制（366.1）没有消费方（无 continuous.location /
 *   permission 原语），Finalize 的区域合法性检查也未接入卡牌程序。
 * 依赖：RIFT-9（cost.pay / cost.printed）、RIFT-89、RIFT-120。
 */
const flameChompers = {
  canonicalCardId: "card.hash-0f5f84f75dbe0744c93412016da28963e78fa05c747a4b3163be7cfef5f26cc9",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "『you may pay :rb_rune_fury: to play me』接受分支缺 cost.pay / cost.printed 指令原语：effects/instructions/ 只有 effect.* 文件，" +
    "费用计划与支付属 RIFT-89 管线，effect.play 只接受已 Finalize 的费用计划而不推导/支付费用；从 Trash 打出还需要 366.1 的区域许可接线" +
    "（无 continuous.location / permission 消费方）。触发时点 card-discarded（423.1.b）已定义，拒绝分支有执行测试。" +
    "依赖：RIFT-9（cost.pay / cost.printed）、RIFT-89、RIFT-120。不近似实现。",
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

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
 *   计划（只声明 1 Fury Power，替代本卡印刷的 3 Energy 基础费用；省略 energy
 *   组件不改变卡牌的印刷值）。
 * - effect.play 的 TargetSpec 用 { source: "self" } 锚点（IR 静态数据用契约 3.6 的
 *   符号选择器，不写运行时 ObjectRef）选择仍在 Trash 的本卡。
 * - effect.play 已支持 finalized cost override，chain/engine.ts 会将其接入费用计划；
 *   Fury 替代费用不再是缺口。测试内核可证明费用计划与支付回执，不证明 Power 扣除。
 *
 * 未完成部分（不近似实现）:
 * - 绑定器当前拒绝 effect.play 的 self/source Trash 目标过滤，无法把接受分支
 *   绑定到仍在 Trash 的本卡。
 * - 接受分支仍缺从 Trash 的区域许可（366.1）与嵌套 play 目标生命周期的流程绑定；
 *   单独的费用计划与支付回执不能证明该分支已完整执行。
 */
const flameChompers = {
  canonicalCardId: "card.hash-0f5f84f75dbe0744c93412016da28963e78fa05c747a4b3163be7cfef5f26cc9",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "『you may pay :rb_rune_fury: to play me』的触发时点与可选分支已写入 IR；" +
    "Fury 替代费用已支持由 effect.play 的 finalized cost override 接入链费用计划；" +
    "但程序绑定器会因 effect.play 的 self/source Trash 目标过滤而拒绝接受分支，" +
    "且当前完整结算仍缺 366.1 区域许可和嵌套 play 目标生命周期的流程绑定。" +
    "拒绝分支与 play 子效果已有执行测试，不近似实现。",
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

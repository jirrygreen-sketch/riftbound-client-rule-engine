import type { CardProgram } from "../../ir/index.js";

/**
 * Magma Wurm (ogn-011-298) — Unit, Fury, Freljord, energy 8, Power 1, Might 8.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ogn-011-298，逐字）:
 *   "Other friendly units enter ready."
 *
 * 规则依据（Core Rules v1.5）:
 * - 359.2.c：单位默认以横置状态进场；改动"进入 Board 的方式"的能力是替代效果。
 * - 369.3："Replacement Effects that apply to a unit as it enters the Board"，
 *   官方示例 "I enter ready." 即把横置进场事件替换为就绪进场；364.3/364.3.a 说明
 *   被动能力可以是持续生效的替代效果。
 * - 366 / 365.1：战场上永久物的被动能力在 Board 上生效；"Other friendly units"
 *   排除来源自身。注意本卡与 Accelerate（805.6）不同：Accelerate 的替代来源就是
 *   进场单位本身，本卡的替代来源是 Magma Wurm、被替代事件的对象才是进场的友方单位。
 *
 * 结构说明（本卡标记 judge-required，见下）:
 * - 用一个 replacement 能力（契约 3.1）声明：被替代事件是其他友方单位进入 Board，
 *   替代结果是该单位以就绪状态进场；filter 的 other: true 排除本卡自身。
 * - 注意 effect.ready 自己的文档声明："enter ready 是入场替代，不是事后重置"，本
 *   原语不能用来模拟入场替代（359.2.c、369.3、805.6）。with 体里的 objects 用
 *   "source" 选择符指称"被替代事件中即将进场的单位"——与已合入的 Accelerate 关键词
 *   文件（effects/keywords/Accelerate.ts 的 805.6 入场替代）对同一约定一致：替代
 *   管线把 source 绑定到被替代的进场事件对象（对 Accelerate 而言恰好也是它自己）。
 *   真实执行必须由 replacement.enter 替代管线在进场事件提交前完成，不能靠事后调用
 *   effect.ready；本文件也不把该对象
 *   伪装成 TargetSpec（那会错误地引入目标相关触发，355.7）。
 *
 * 未合入依赖 + 契约缺口（不近似实现）:
 * - 没有 replacement.enter 替代管线（RIFT-9 清单；events/pipeline.ts 有替代注册表，
 *   但没有读取 CardProgram replacement 能力并注册的消费方）。
 * - "source" 在替代事件里指称被替代事件对象的绑定规则目前只由 Accelerate 关键词
 *   文件的注释约定，契约 3.6 未把它写进 ObjectSelector 语义；已在最终回复提出契约
 *   变更请求（请明确替代效果内 source 的绑定）。
 * 依赖：RIFT-9（replacement.enter）、RIFT-91、RIFT-120。
 */
const magmaWurm = {
  canonicalCardId: "card.hash-d92b1df4324a20717aaeab68c916883889ea337f917bdf10104e9df82f9a3c19",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "『Other friendly units enter ready』是入场替代效果（CR 369.3；单位默认横置进场 359.2.c）：缺 replacement.enter 替代管线" +
    "（RIFT-9 清单；events/pipeline.ts 的替代注册表没有 CardProgram 消费方），而 effect.ready 文档明确它只能重置场上对象、不能模拟 enter ready" +
    "（359.2.c / 369.3 / 805.6）；with 体用 source 选择符指称被替代事件的进场单位（与 Accelerate 关键词文件对 805.6 的约定一致），" +
    "但该绑定语义未写入契约 3.6，已提交契约变更请求。依赖：RIFT-9（replacement.enter）、RIFT-91、RIFT-120。不近似实现。",
  abilities: [
    {
      kind: "replacement",
      replaces: {
        event: "object-enters-board",
        filter: { type: "unit", controller: "controller", other: true, zone: "board" }
      },
      with: [
        {
          id: "magma-wurm.enter-ready",
          op: "effect.ready",
          args: {
            objects: { kind: "constant", value: { kind: "source" } }
          }
        }
      ]
    }
  ],
  sourceText: "Other friendly units enter ready."
} satisfies CardProgram;

export default magmaWurm;

import type { CardProgram } from "../../ir/index.js";

/**
 * Direwing (sfd-094-221) — Unit, 7 energy, 无印刷 Power, Might 7，
 * 领域 Body，标签 Dragon / Demacia。
 *
 * sourceText（packages/card-data/data/deck-catalog.json sfd-094-221，逐字）：
 *   "I enter ready if you control another Dragon."
 *
 * 规则依据（Core Rules v1.5）：
 * - 143.4 / 359.2.c：单位默认以 Exhausted 进入 Board；"I enter ready" 就是这条默认的例外，
 *   官方把这类写法列在入场替代下（369.3 的 Master Yi, Honed 示例；805.6 对 Accelerate
 *   说明「不是先横置入场再重置」，而是替换入场状态本身）。
 * - 364.3 / 364.3.a："if you control another Dragon" 是 Condition 引导的条件被动，功能上
 *   描述该替代效果的适用条件；364.3.a 的示例 "If an opponent controls a battlefield, I enter
 *   ready." 正是同一句式。
 * - 133.8 / 133.8.a："Dragon" 是标签，本身没有内在规则含义，只在被文本引用时生效；筛选按
 *   tags + 控制者表达。"another" 排除来源自身（740.1.a 的惯例，用 exclude: "self"）。
 * - 因此本条按契约 3.1 写成 replacement 能力（replaces: object-enters-board，with 体为
 *   effect.ready），条件用 count + filter 的 compare；不写事后 effect.ready。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required。
 * - 替代绑定库（RIFT-260）已合入，但没有生产方把 CardProgram 的 replacement 能力注册成
 *   ReplacementRegistration（卡牌程序绑定 RIFT-257 未合入 HEAD）；heroic 的 golden 只能
 *   手动调 bindReplacement，证明的是库本体，不是卡牌接线。
 * - 更关键：已合入的 entry-declaration 匹配路径（replacement/bind.ts matchesEnterAction）
 *   不评估能力 condition —— 实测「没有另一条 Dragon 时」入场单位仍被替换成就绪进场。
 *   把这条静态入场改写绑进管线会产生错误结果，因此本卡不能标 executable。
 * - 条件的「another Dragon」占位符同样没有消费方：filter 里的 controller: "controller"
 *   与 exclude: "self" 由 chain/engine.ts 的 query 归一化只认 self/opponent，替代匹配侧的
 *   filterMatchesSnapshot 也不解析 exclude 锚点。
 * 依赖：RIFT-257（替代绑定 + entry 替代的 condition 求值）、占位符与 exclude 锚点消费。
 * 不近似实现（不把入场替代写成事后 effect.ready，也不把条件写成恒真）。
 */
export default {
  canonicalCardId: "card.hash-733ee080aef6259973bf03c5ede49e36dd44b081fa4f1040aa0ec8525bcf71b9",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「I enter ready if you control another Dragon」是入场替代（143.4 / 359.2.c / 369.3，364.3.a 的官方同型示例）：" +
    "替代绑定库已合入（RIFT-260），但没有生产方把 CardProgram 的 replacement 能力注册进事件管线（卡牌程序绑定 RIFT-257 未合入 HEAD）。" +
    "且已合入的 entry-declaration 路径不评估能力 condition：replacement/bind.ts 的 matchesEnterAction 只比对 filter，" +
    "实测没有另一条 Dragon 时单位仍被替换成就绪进场——把它接进管线会得到错误结果，不能算可执行。" +
    "条件的「another Dragon」也没有求值方：filter 的 controller: \"controller\" 与 exclude: \"self\" 占位符不被 chain/engine.ts 的 query 归一化识别" +
    "（只认 self/opponent），替代匹配侧也不消费 exclude 锚点。" +
    "依赖：RIFT-257（卡牌替代绑定与 entry 替代的 condition 求值）、占位符与 exclude 锚点消费。" +
    "不近似实现（不把入场替代写成事后 effect.ready，也不把条件写成恒真）。",
  abilities: [
    {
      kind: "replacement",
      replaces: {
        event: "object-enters-board",
        // 143.4 / 359.2.c：只替换「横置入场」这条默认。
        filter: { source: "self", exhausted: true }
      },
      // 364.3/364.3.a："if you control another Dragon" 是替代效果的适用条件（不是 body 里
      // 某条指令的 condition）。
      condition: {
        kind: "compare",
        left: {
          kind: "count",
          subject: "dragons",
          filter: {
            type: "unit",
            tags: ["Dragon"],
            controller: "controller",
            zone: "board",
            exclude: "self"
          }
        },
        operator: "gte",
        right: { kind: "constant", value: 1 }
      },
      with: [
        {
          id: "direwing.enter-ready",
          op: "effect.ready",
          args: {}
        }
      ]
    }
  ],
  sourceText: "I enter ready if you control another Dragon."
} satisfies CardProgram;

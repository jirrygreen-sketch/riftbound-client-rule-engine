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
 * - 替代体注册即阻塞：replacement/bind.ts 经 replacement/planner.ts 校验替代体时，
 *   with 里的裸 effect.ready args: {} 没有对象选择符，抛 BlockedReplacementError:
 *   effect.ready/effect.exhaust requires an object selector，替代从未注册；
 *   entry-declaration 静态声明只接受 objects: { kind: "constant", value: { kind: "source" } }
 *   这类对象选择符（805.6 Accelerate 的写法），裸 args: {} 是 effect 解释器的
 *   play-body 写法。
 * - 条件缺口：ability.condition 的 count + filter 走解释器 queryObjects，
 *   exclude: "self" 锚点会正确排除自身（不是缺口）；但 controller: "controller"
 *   占位符在生产 query 归一化（chain/engine.ts）里只认 self/opponent，会被当作
 *   字面玩家 id 比对，条件恒为 false；另外 replacement/bind.ts 的 matches() 在
 *   matchesEnterAction 命中时直接返回 true，不评估 ability.condition。
 * 依赖：entry 替代体的对象选择符形态、controller: "controller" 占位符的真实绑定、
 *   entry 替代条件的求值门控。
 * 不近似实现（不把入场替代写成事后 effect.ready，也不把条件写成恒真）。
 */
export default {
  canonicalCardId: "card.hash-733ee080aef6259973bf03c5ede49e36dd44b081fa4f1040aa0ec8525bcf71b9",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「I enter ready if you control another Dragon」是入场替代（143.4 / 359.2.c / 369.3，364.3.a 的官方同型示例）。" +
    "当前缺口有两处：(1) 注册即阻塞——replacement/bind.ts 经 replacement/planner.ts 校验替代体时，" +
    "with 里的裸 effect.ready args: {} 没有对象选择符，抛 BlockedReplacementError: effect.ready/effect.exhaust requires an object selector，" +
    "替代从未注册；entry-declaration 静态声明只接受 objects: { kind: \"constant\", value: { kind: \"source\" } } 这类对象选择符" +
    "（805.6 Accelerate 的写法），裸 args: {} 是 effect 解释器的 play-body 写法。" +
    "(2) ability.condition 的 count + filter 走解释器 queryObjects，exclude: \"self\" 锚点会正确排除自身（不是缺口）；" +
    "但 controller: \"controller\" 占位符在生产 query 归一化（chain/engine.ts）里只认 self/opponent，" +
    "会被当作字面玩家 id 比对而永远失配，条件恒为 false；另外 replacement/bind.ts 的 matches() 在 matchesEnterAction 命中时直接返回 true，" +
    "不评估 ability.condition。" +
    "依赖：entry 替代体的对象选择符形态、controller: \"controller\" 占位符的真实绑定、entry 替代条件的求值门控。" +
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

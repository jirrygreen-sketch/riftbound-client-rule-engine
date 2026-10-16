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
 * - replacement.enter 没有已合入的消费管线：events/pipeline.ts 的 ReplacementRegistration
 *   需要调用方提供 matches/apply 代码，没有任何代码把 CardProgram 的 replacement 能力注册成
 *   Registration（与 sfd/breakneck-mech、sfd/xin-zhao-vigilant 记录同一缺口）；effect.ready
 *   的文件头也明确它不参与入场替代，不能拿它模拟。
 * - "another Dragon" 的 tags 筛选与 exclude: "self" 锚点没有已合入的求值方：layers/filter.ts
 *   只接受 tags 全等数组、不识别 exclude；解释器的 query 锚点是符号选择器（契约 3.6），而
 *   触发/替代侧的 matchesObjectFilter 不解析 tags 数组之外的 "other" 语义。
 * 依赖：replacement.enter 与卡牌替代注册（引擎批 4/5）、标签筛选与 exclude 锚点消费（RIFT-90）。
 * 不近似实现（不把入场替代写成事后 effect.ready，也不把条件写成恒真的 count）。
 */
export default {
  canonicalCardId: "card.hash-733ee080aef6259973bf03c5ede49e36dd44b081fa4f1040aa0ec8525bcf71b9",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「I enter ready if you control another Dragon」是入场替代（143.4 / 359.2.c / 369.3，364.3.a 的官方同型示例）：" +
    "replacement.enter 没有已合入的消费管线——events/pipeline.ts 的 ReplacementRegistration 需要调用方提供 " +
    "matches/apply 代码，没有任何代码把 CardProgram 的 replacement 能力注册成 Registration" +
    "（sfd/breakneck-mech、sfd/xin-zhao-vigilant 记录同一缺口），effect.ready 文件头也明确它不参与入场替代，" +
    "不能作为事后重置的替代。条件的「another Dragon」同样没有可执行求值方：133.8/133.8.a 的标签筛选需要 " +
    "tags + 控制者 + 排除来源三者同时成立，而 layers/filter.ts 的 tags 匹配是全等数组、不识别 exclude 锚点，" +
    "解释器侧 query 的 exclude 锚点（契约 3.6）在替代注册链路不可达。" +
    "依赖：replacement.enter 与卡牌替代注册（引擎批 4/5，RIFT-9/RIFT-120）、标签筛选与 exclude 消费（RIFT-90）。" +
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

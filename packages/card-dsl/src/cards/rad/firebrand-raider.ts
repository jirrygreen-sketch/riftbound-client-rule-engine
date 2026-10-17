import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Firebrand Raider (rad-019-167) — Unit, Fury, 6 energy / 1 power / 6 Might.
 *
 * 原文（deck-catalog rad-019-167，逐字）：
 *   "I enter ready.\nWhen you play me, ready all enemy units.\nOther units enter ready.\n" +
 *   "Units don't ready during the Awaken Phase."
 *
 * 规则依据（CR v1.5）：
 * - “I enter ready.”：143.4 默认横置进场 + 369.3 入场替代（同 rad-009-167）；
 * - “When you play me, ready all enemy units.”：Play Effect（383.4.a）+ 非目标集合重置
 *   （355.10.d “all …”，effect.ready 的 query 选择；敌方单位由 filter controller: opponent）；
 * - “Other units enter ready.”：对场上其他单位的入场替代（365.1 持续能力只在 Board 生效）；
 * - “Units don't ready during the Awaken Phase.”：Awaken 阶段常规重置（315.1.b）的静态限制，
 *   属 continuous.restrict（effect.ready 文件明确本原语不实现该限制）。
 *
 * status: judge-required（不近似实现）：
 * - “I enter ready.” 的入场替代已可用：RIFT-260 的绑定把单一 self 目标 effect.ready 体识别为
 *   entry-orientation 声明，golden 用真实事件管线执行并断言“就绪进场、无 object-readied 时点”。
 * - “Other units enter ready.” 仍未解决：它作用于其他单位的入场，需要替代体引用“被替代事件的对象”，
 *   而卡牌 IR 只能按 TargetSpec/pick/linked 选择器表达；把它写成 self 目标会被绑定层拒绝，
 *   写成 choice.optional 等包装也会被替代规划器拒绝；当前替代体不能把带
 *   replacement.object 的正文写成可绑定的 replacement.event 形状。
 * - “Units don't ready during the Awaken Phase.” 用已合入的 continuous.restrict 记录，但没有消费者：
 *   Awaken 阶段（315.1.b）的就绪流程不查图层限制；CardProgram 的 static/replacement 生命周期绑定已存在，
 *   当前缺口是 Awaken 就绪流程消费该 restriction。
 * - “ready all enemy units” 本身已可执行（effect.ready + query），golden 测试真实执行该指令。
 *
 * 依赖：替代体正文的事件对象绑定与 Awaken 就绪流程的 restriction 消费。
 */
const abilities: Ability[] = [
  {
    kind: "replacement",
    // 143.4 / 359.2.c：默认横置进场；369.3 的入场状态改写。
    replaces: { event: "object-enters-board", filter: { source: "self", exhausted: true } },
    // RIFT-260 的 entry-orientation 形式：单一 self 目标的 effect.ready，由绑定层
    // 改写成“就绪进场”（不产生 object-readied 时点，805.6.a）。
    with: [
      {
        id: "firebrand-raider.enter-ready",
        op: "effect.ready",
        args: { objects: { kind: "constant", value: { kind: "source" } } }
      }
    ]
  },
  {
    kind: "triggered",
    trigger: { at: "card-played", filter: { self: true } },
    optional: false,
    body: [
      {
        id: "firebrand-raider.ready-enemy-units",
        op: "effect.ready",
        args: {
          objects: {
            kind: "constant",
            value: {
              kind: "query",
              filter: { zone: "board", type: "unit", controller: "opponent" }
            }
          }
        }
      }
    ]
  },
  {
    kind: "replacement",
    // 365.1 的持续能力：其他单位横置进场时改写为就绪进场。替代体必须指向
    // “被替代事件的对象”，合并 IR 的选择器词汇（self/source/target/pick/linked）
    // 没有该指代，绑定层的 replacement.object 链接值也只有经 replacement.event
    // 声明才可用（本卡的静态 replaces 形式拿不到）；故只保留可审查形状。
    replaces: { event: "object-enters-board", filter: { type: "unit", other: true, exhausted: true } },
    with: [
      {
        id: "firebrand-raider.others-enter-ready",
        op: "effect.ready",
        args: { objects: { kind: "constant", value: { kind: "linked", key: "replacement.object" } } }
      }
    ]
  },
  {
    kind: "static",
    effect: {
      kind: "continuous.restrict",
      mode: "prevent",
      event: "ready",
      during: "awaken-phase",
      filter: { zone: "board", type: "unit" }
    }
  }
];

const program = {
  canonicalCardId: "card.hash-f4847d9fdb97d7ccf7a9d4a296e64e63e5d8c219daa10d1016d79ae12591dc77",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处缺口，均不近似实现：" +
    "(1) “Other units enter ready.”（365.1 的其他单位入场改写）需要替代体指向“被替代事件的对象”，" +
    "合并 IR 的对象选择器只有 self/source/target/pick/linked；绑定层只在 replacement.event 声明里暴露 " +
    "replacement.object 链接值，而带有该正文的替代会被规划器拒绝（replacement.event 的 instead 必须是" +
    "指令数组，IR 的 Expr 包装形状不可表达），故无法诚实订阅。" +
    "(2) “Units don't ready during the Awaken Phase.” 已用 continuous.restrict 记录（RIFT-259），" +
    "但 Awaken 阶段（315.1.b）的常规就绪流程不读图层限制；CardProgram 的 static/replacement 生命周期绑定已存在，" +
    "当前缺口是 Awaken 就绪流程消费该 restriction。" +
    "已可执行并真实执行的两段：“I enter ready.”（RIFT-260 的 entry-orientation 替代，" +
    "golden 断言就绪进场且无 object-readied 时点）与“When you play me, ready all enemy units.”" +
    "（effect.ready + 非目标 query，355.10.d）。",
  abilities,
  sourceText:
    "I enter ready.\nWhen you play me, ready all enemy units.\nOther units enter ready.\n" +
    "Units don't ready during the Awaken Phase."
} satisfies CardProgram;

export default program;

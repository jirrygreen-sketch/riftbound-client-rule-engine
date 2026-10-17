import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Ahri, Confident (rad-038-167) — Unit, 4 energy + 1 Calm power, 4 Might.
 *
 * 原文："[Disarm] (When I attack, give an enemy unit here -1 :rb_might: this turn.)\n"
 *       "When you reduce the Might of an enemy unit here by 1 or more, give me "
 *       "+1 :rb_might: this turn."
 *
 * 规则依据（CR v1.5）：
 * - 831.1 / 831.1.b / 831.1.d：Disarm 是触发式能力关键词（Attack Trigger），功能等价于
 *   "When I attack, give an enemy unit here -X [M] this turn"；831.1.c.3：省略 X 时按 1。
 *   keyword 声明不带 value（默认 1），展开由 effects/keywords/<keyword>.ts 负责。
 * - "When you reduce the Might of an enemy unit here by 1 or more"：Might 变化时点
 *   might-changed（events/timing-points.ts，payload 含 previousMight/currentMight，709），
 *   生产函数是 events/producers/might-change.ts 的 deriveMightChangedEmissions（RIFT-270）。
 *   过滤条件要求减少方向且幅度 ≥ 1、对象是"你控制的任一效果"所减少的敌方单位——原文的
 *   "you reduce" 只看动作是否由你方效果造成（契约 3.4 结算时检查行动）。
 * - "give me +1 [M] this turn"：临时 Might 修改 = arithmetic 层的持续效果，
 *   期限到本回合结束（143.2.a / 475 / continuous.duration）。
 *
 * status 判定（README 第 2 节）：judge-required。缺口（不近似实现）：
 * 1. Disarm KeywordDef（RIFT-267，effects/keywords/Disarm.ts）与 continuous.might
 *    （RIFT-258）已合入：展开形状与 +1 [M] 图层注册都真实执行，但展开的 attack-declared
 *    触发没有生产者——combat/flow.ts 在战斗开始处仍抛 combat-start-transaction
 *    （docs/rules/timing-point-producers.md 记 attack-declared 为待后续）。
 * 2. might-changed 只有 producers/might-change.ts 的纯函数，没有任何生产调用方在图层
 *    重算后把 before/after 交给它并发进唯一事件管线（同文档：接入点待接线），因此第二段
 *    触发无法被命中。
 * 3. “reduce … by 1 or more” 的过滤没有求值路径：EventPattern.details 只比较字面标量，
 *    无法比较 previousMight/currentMight 两个载荷字段的大小；触发过滤也不消费
 *    sameLocationAs 锚点。
 * 4. 触发订阅还需要 CardProgram → TriggerRegistration 绑定（RIFT-257）。
 * 依赖：attack-declared / might-changed 的生产接线、事件载荷谓词与 RIFT-257。
 * status 判定（README 第 2 节）：judge-required（复核 2026-10-17）。缺口（不近似实现）：
 * 1. 第二段触发订阅在绑定阶段就失败：「here」用的 sameLocationAs 锚点被 RIFT-257 的
 *    programs/filters.ts 判 “Unsupported filter field sameLocationAs”，实测
 *    registerProgramTriggers 抛 ProgramBindingError。该锚点在 Disarm 展开的 TargetSpec
 *    里同样会被拒（translateInstructionTargets 走同一 translateObjectFilter）。
 * 2. 即便锚点可表达，might-changed 也命中不了：该时点不在 EVENT_PATTERN_TYPES
 *    （events/trigger-spec.ts），会在 pipeline.registerTrigger 的 assertTriggerSpec
 *    处被判 invalid-event-type；且 events/producers/might-change.ts 的
 *    deriveMightChangedEmissions 没有任何生产调用方在图层重算后把 before/after 交给它并入
 *    唯一事件管线（docs/rules/timing-point-producers.md 记接入点待接线）。
 * 3. “reduce … by 1 or more” 的幅度过滤没有求值路径：EventPattern.details 只比较字面标量，
 *    无法比较 previousMight/currentMight 的大小；而 RIFT-257 的 programs/filters.ts 会把
 *    details 交给 translateObjectFilter，只认
 *    objectId/cardId/type/controller/owner/zone/location/states/tags/characteristics，
 *    顶层 details 直接抛 ProgramBindingError。
 * 4. Disarm 展开订阅的 attack-declared 没有生产者：combat/flow.ts 的战斗开始/角色指定仍抛
 *    combat-start-transaction（docs/rules/timing-point-producers.md 记 attack-declared 为待后续）。
 * RIFT-257 的 CardProgram → TriggerRegistration 绑定与 RIFT-267 的 Disarm KeywordDef、
 * RIFT-258 的 continuous.might 均已合入，不再是缺口。
 */

const abilities: Ability[] = [
  // 831.1.c.3：印刷未写 X，Disarm 值为 1，故 keyword 声明省略 value。
  { kind: "keyword", keyword: "disarm" },
  {
    kind: "triggered",
    trigger: {
      at: "might-changed",
      filter: {
        event: "might-changed",
        filter: {
          type: "unit",
          controller: "opponent",
          // "here"：与来源同在 Battlefield Zone / Base（464.2.b 的 here referent）。
          sameLocationAs: "self",
          // 709 的 must 方向：只统计减少，且至少 -1。
          mightChanged: "decreased",
          amount: { gte: 1 }
        }
      }
    },
    optional: false,
    body: [
      {
        id: "ahri-confident.give-me-might",
        // 临时 Might 修改（arithmetic 层 + 本回合结束到期）：continuous.might（RIFT-258）
        // 自行注册 arithmetic 层 spec（layer 不是本原语的参数）。
        // “give me” 的“me”是能力宿主，用契约 3.6 的 appliesTo: "self" 简写
        // （与已合入 sfd/harpoon-squad 同一形状）；不用 target 指向一个
        // filter 里塞 object: "self" 的假 TargetSpec——那既不是符号选择器，
        // 也会被 RIFT-257 的 translateObjectFilter 判 “Unsupported filter field object”。
        op: "continuous.might",
        args: {
          mode: { kind: "constant", value: "add" },
          amount: { kind: "constant", value: 1 },
          duration: { kind: "constant", value: "end-of-turn" },
          appliesTo: { kind: "constant", value: "self" }
        },
      }
    ]
  }
];

const program = {
  canonicalCardId:
    "card.hash-b5c30bb9570eb87f81c02526593c66f04d242c43ca13f9e3f0e38ed148fe62c1",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "(1)「here」不可表达：触发过滤的 sameLocationAs 锚点被 RIFT-257 的 translateObjectFilter 判 " +
    "Unsupported filter field sameLocationAs，实测 registerProgramTriggers 抛 ProgramBindingError；" +
    "Disarm 展开的 TargetSpec 走同一 translateObjectFilter，也会被同一原因拒绝。" +
    "(2) might-changed 时点不可订阅：它不在 EVENT_PATTERN_TYPES（events/trigger-spec.ts），" +
    "pipeline.registerTrigger 的 assertTriggerSpec 会判 invalid-event-type；events/producers/" +
    "might-change.ts 的 deriveMightChangedEmissions 也仍无生产调用方（图层重算后没有把 before/after " +
    "并入事件管线的接线，docs/rules/timing-point-producers.md 记接入点待接线）。" +
    "(3)「reduce … by 1 or more」的幅度过滤没有求值路径：EventPattern.details 只比较字面标量，" +
    "无法比较 previousMight/currentMight 大小；RIFT-257 的 programs/filters.ts 又把 details 交给 " +
    "translateObjectFilter（只认 objectId/cardId/type/controller/owner/zone/location/states/tags/" +
    "characteristics），顶层 details 直接抛 ProgramBindingError。" +
    "(4) Disarm 展开订阅的 attack-declared 没有生产者——combat/flow.ts 在战斗开始/角色指定处仍抛 " +
    "combat-start-transaction（同文档记 attack-declared 待后续）。" +
    "RIFT-267 的 Disarm KeywordDef、RIFT-258 的 continuous.might 与 RIFT-257 的 CardProgram 绑定" +
    "均已合入，不再是缺口。不近似实现：不使用 Buff counter 代替 Might 修改。",
  abilities,
  sourceText:
    "[Disarm] (When I attack, give an enemy unit here -1 :rb_might: this turn.)\n" +
    "When you reduce the Might of an enemy unit here by 1 or more, give me +1 :rb_might: this turn."
} satisfies CardProgram;

export default program;

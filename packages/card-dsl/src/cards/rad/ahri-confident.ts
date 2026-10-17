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
        op: "continuous.might",
        args: {
          mode: { kind: "constant", value: "add" },
          amount: { kind: "constant", value: 1 },
          duration: { kind: "constant", value: "end-of-turn" },
          target: { kind: "constant", value: "ahri-confident.self" }
        },
        targets: [
          {
            id: "ahri-confident.self",
            filter: { type: "unit", object: "self" },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
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
    "Disarm KeywordDef（RIFT-267 / effects/keywords/Disarm.ts）与 continuous.might（RIFT-258）已合入，" +
    "展开体与 +1 [M] 的 arithmetic 图层注册都已真实执行，但整卡仍不能 executable：" +
    "(1) Disarm 展开订阅的 attack-declared 没有生产者——combat/flow.ts 在战斗开始/角色指定处仍抛 " +
    "combat-start-transaction（docs/rules/timing-point-producers.md 记 attack-declared 待后续）；" +
    "(2) might-changed 只有 producers/might-change.ts 的纯生产函数，没有任何模块在图层重算后调用它" +
    "并入事件管线（同文档：接入点待接线）；(3)「reduce … by 1 or more」的过滤没有求值路径：" +
    "EventPattern.details 只比较字面标量，不能比较 previousMight/currentMight 的大小，触发匹配器" +
    "也不消费 sameLocationAs 锚点；(4) 订阅还需要 CardProgram → TriggerRegistration 绑定（RIFT-257）。" +
    "不近似实现：不使用 Buff counter 代替 Might 修改。",
  abilities,
  sourceText:
    "[Disarm] (When I attack, give an enemy unit here -1 :rb_might: this turn.)\n" +
    "When you reduce the Might of an enemy unit here by 1 or more, give me +1 :rb_might: this turn."
} satisfies CardProgram;

export default program;

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
 * status = judge-required（2026-10-17 源码复核）：
 * - sameLocationAs 已有解释器集合查询，但 programs/filters.ts 仍拒绝触发/目标上的
 *   该锚点，Disarm 与第二段触发都不能完成来源位置绑定。
 * - might-changed 不在 EVENT_PATTERN_TYPES，deriveMightChangedEmissions 仍只有定义，
 *   没有图层重算后的生产调用；还缺减少幅度和“you reduce”的施动者归属过滤。
 * - attack-declared 的战斗指定事务仍被 combat-start-transaction 阻断。
 * Disarm 展开、continuous.might 与程序绑定已合入；只验证这些已支持部分。
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
        // 也会被 translateObjectFilter 判 “Unsupported filter field object”。
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
    "(1)「here」的 sameLocationAs 锚点仍被 programs/filters.ts 的 translateObjectFilter 拒绝；Disarm 的 TargetSpec 与第二段触发均需来源位置绑定（CR 053.3 / 831.1.b）。" +
    "(2) might-changed 不在 EVENT_PATTERN_TYPES，deriveMightChangedEmissions 没有图层重算后的生产调用；" +
    "触发过滤还缺 previousMight/currentMight 的减少幅度比较及「you reduce」的效果控制者归属，不能把任意敌方 Might 变化算入。" +
    "(3) Disarm 所需 attack-declared 仍无战斗指定事务生产者，combat/flow.ts 抛 combat-start-transaction（466.2 / 831.1）。不使用 Buff counter 代替临时 Might。",
  abilities,
  sourceText:
    "[Disarm] (When I attack, give an enemy unit here -1 :rb_might: this turn.)\n" +
    "When you reduce the Might of an enemy unit here by 1 or more, give me +1 :rb_might: this turn."
} satisfies CardProgram;

export default program;

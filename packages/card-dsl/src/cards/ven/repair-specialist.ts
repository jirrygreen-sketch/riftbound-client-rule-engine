import type { CardProgram, Expr } from "../../ir/index.js";

/**
 * Repair Specialist (ven-076-166) — Unit, 3 Energy, 3 Might, Body, Zaun
 * （无印刷 Power）。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-076-166，逐字）：
 *   I have [Assault] equal to the number of gear you control. (+1 :rb_might:
 *   while I'm an attacker for each instance of Assault.)
 *
 * 规则依据（CR v1.5）：
 * - 807.1 / 807.1.a：Assault 是被动能力关键词，出现在单位上；807.1.b / 807.1.b.2
 *   规定格式 “Assault [X]”，X 是 Assault Value。
 * - 807.1.c：Assault 功能上等同“While I am an attacker, I have +X [M]”。
 * - 807.2：多个来源授予的 Assault 数值相加并合并为一个；807.3：是否具有 Assault 是
 *   可读取的特征。
 * - 355.9.a.1：“gear” 指 Board 上的 gear；“you control” 的控制器由契约 3.6 的符号
 *   占位符表达（卡程序不写运行时 PlayerId）。
 * - 授予的动态数值按结算 / 计算时读取：“equal to the number of gear you control” 用
 *   契约 3.6 的 count 表达式表达（取值时机即调用时）。
 *
 * status = judge-required（缺口见 judgeReason，均不近似实现）：
 * 1. layers 引擎不会求值 continuous.grant-keyword 的 count 表达式，运行时被授予的
 *    Assault 也没有 +X [M] 消费方，因此动态数值无法落地；
 * 2. 已合入的 Assault 展开的 attacker 条件读 property "designation"，而对象快照实际
 *    只带 combatRole，条件恒为 false。
 * 依赖：layers 表达式求值、运行时授予的 Assault 消费方、快照 designation 落地。
 * 数值表达式本身可由解释器真实求值，golden 用解释器 + 参考内核断言“你控制的 gear 数”
 * 的取值（含对手 gear 与其它区域的排除）。
 */

/** “equal to the number of gear you control”（356 无关；807.1.b.2 的 X 取值）。 */
const gearCount: Expr = {
  kind: "count",
  subject: "gear-you-control",
  filter: { type: "gear", controller: "self", zone: "board" }
};

export default {
  canonicalCardId: "card.hash-210dea8c8d67186f11b18e71dd84b78b75323c6b47d01f2b60448fa17bf2ae8a",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处缺口：(1) layers 引擎对 continuous.grant-keyword 的 count 表达式不求值（valueOf 原样透传），" +
    "运行时被授予的 Assault 也没有把关键词实例转成 +X [M] 算术层的消费方；" +
    "(2) 已合入的 Assault 展开的 attacker 条件读 property \"designation\"，但对象快照实际只带 " +
    "combatRole（测试内核默认 null），条件恒为 false，因此即便授予成功也无法做到“只在攻击时 +X [M]”。" +
    "数值表达式「你控制的 gear 数」已由 golden 用真实解释器求值（排除对手 gear 与非 Board 区域）；" +
    "不近似实现（不改写为固定数值的关键词声明）。",
  abilities: [
    {
      kind: "static",
      effect: {
        kind: "continuous.grant-keyword",
        // 807.1.b.2 的 Assault Value 为动态表达式；“I”（053.1）用 appliesTo: "self"。
        keyword: "Assault",
        value: gearCount,
        appliesTo: "self"
      },
      condition: { kind: "always" }
    }
  ],
  sourceText:
    "I have [Assault] equal to the number of gear you control. (+1 :rb_might: while I'm an " +
    "attacker for each instance of Assault.)"
} satisfies CardProgram;

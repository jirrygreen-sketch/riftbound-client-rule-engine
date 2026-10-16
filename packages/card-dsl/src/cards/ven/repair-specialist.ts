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
 * status = judge-required（两处缺口均不近似实现）：
 * 1. 没有持续授予关键词的可执行路径：卡牌侧 continuous.grant-keyword 没有注册 / 求值
 *    原语（effects/instructions/ 下没有该 op），也没有任何已合入路径把 CardProgram 的
 *    static 能力注册为 ContinuousEffectSpec（RIFT-91 只合入了 layers 引擎）；
 * 2. 已合入的 Assault 展开（effects/keywords/Assault.ts）消费固定数值，其 attacker
 *    条件读的是 ObjectSnapshot.combatRole（契约 3.8 增补），该特征尚未落地、
 *    layers/engine.ts 的 conditionMatches 也还不识别 compare 条件，因此即使授予成功，
 *    “只在攻击时 +X [M]” 也无法正确生效。
 * 依赖：RIFT-91（layers 接线）、契约 3.8 的 combatRole 落地与 RIFT-81 的关键词展开收敛。
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
    "两处缺口：(1) 「I have [Assault] equal to the number of gear you control」需要持续授予关键词，" +
    "但卡牌侧 continuous.grant-keyword 没有注册/求值原语（effects/instructions/ 下没有该 op），也没有任何" +
    "已合入路径把 CardProgram 的 static 能力注册成 ContinuousEffectSpec（RIFT-91 只合入了 layers 引擎）；" +
    "(2) 已合入的 Assault 展开消费固定数值，其 attacker 条件读取 ObjectSnapshot.combatRole（契约 3.8 的增补），" +
    "该特征尚未落地、layers/engine.ts 的 conditionMatches 也还不识别 compare 条件，因此即便授予成功也无法" +
    "做到“只在攻击时 +X [M]”（依赖 RIFT-81 关键词收敛与契约 3.8 落地）。数值表达式「你控制的 gear 数」" +
    "已由 golden 用真实解释器求值（排除对手 gear 与非 Board 区域）；不近似实现（不改写为固定数值的关键词声明）。",
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

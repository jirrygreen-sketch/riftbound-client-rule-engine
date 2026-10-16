import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Clanging Sentry (rad-055-167) — Unit, 3 energy, 2 Might, Mind.
 *
 * 原文："Your Mechs have [Disarm]. (When each of us attacks, give an enemy unit "
 *       "there -1 :rb_might: this turn.)"
 *
 * 规则依据（CR v1.5）：
 * - 801.3.a：其他效果可以授予关键词；"Your Mechs have [Disarm]" 是静态的持续授予。
 * - 831.1.b / 831.1.c.3 / 831.1.d：Disarm 是触发式能力关键词（Attack Trigger），
 *   省略 X 时按 1，功能等价于 "When I attack, give an enemy unit here -1 [M] this turn"；
 *   831.2 的官方示例正好是 Clanging Sentry——多个来源授予的 Disarm 值相加成一个触发
 *   （stacking: "sum"），因此这里声明不带 value 的 disarm，由关键词注册表按 831.2 求和。
 *
 * status 判定（README 第 2 节）：judge-required。缺口：
 * 1. `effects/keywords/` 没有 Disarm KeywordDef（RIFT-81~91 关键词批次不含 Disarm），
 *    831.1.d 的触发与临时 Might 修改（continuous.might + continuous.duration，143.2.a / 475）
 *    都还没有实现；
 * 2. `continuous.grant-keyword` 的卡牌侧消费方未合入（LayerEngine 只消费经
 *    ResolveContext.addContinuous 注册的 ContinuousEffectSpec；已合入示例 sfd/forecaster.ts
 *    记录了同一缺口，属 RIFT-91 之后的接线）。
 * 依赖：Disarm KeywordDef（无已分配任务号）、RIFT-91（layers-continuous）。
 */

const abilities: Ability[] = [
  {
    kind: "static",
    effect: {
      kind: "continuous.grant-keyword",
      keyword: "disarm",
      // 831.1.c.3：印刷省略 Disarm 值，按 1；多个来源的 Disarm 值按 831.2 相加。
      value: { kind: "constant", value: 1 },
      filter: { type: "unit", tag: "Mech", controller: "controller", zone: "board" }
    }
  }
];

const program = {
  canonicalCardId:
    "card.hash-664329985c0c826779032a079e87a5c433f6be42cbfb4f724f81fd89fcc9a90a",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "「Your Mechs have [Disarm]」需要两步都未合入的支持：" +
    "(1) effects/keywords/ 没有 Disarm KeywordDef（831.1.d 的攻击触发 + 临时 Might 修改需要 " +
    "continuous.might + continuous.duration，143.2.a / 475），RIFT-81~91 关键词批次不含 Disarm；" +
    "(2) continuous.grant-keyword 的卡牌侧消费方未合入（LayerEngine 只消费 ResolveContext.addContinuous " +
    "注册的持续效果，CardProgram static 未接线，sfd/forecaster.ts 记录了同一缺口）。" +
    "依赖：Disarm KeywordDef（无已分配任务号）、RIFT-91（layers-continuous）。不近似实现。",
  abilities,
  sourceText:
    "Your Mechs have [Disarm]. (When each of us attacks, give an enemy unit there -1 :rb_might: this turn.)"
} satisfies CardProgram;

export default program;

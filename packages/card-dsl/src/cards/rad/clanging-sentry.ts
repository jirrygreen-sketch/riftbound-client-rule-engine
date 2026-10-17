import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Clanging Sentry (rad-055-167) — Unit, 3 energy, 2 Might, Mind.
 *
 * 原文："Your Mechs have [Disarm]. (When each of us attacks, give an enemy unit "
 *       "there -1 :rb_might: this turn.)"
 *
 * 规则依据（CR v1.5）：
 * - 801.3.a：其他效果可以授予关键词；"Your Mechs have [Disarm]" 是静态的持续授予，
 *   落在 ability 图层（契约 3.4 图层顺序、478.1.a）。
 * - 831.1.b / 831.1.c.3 / 831.1.d：Disarm 是触发式能力关键词（Attack Trigger），
 *   省略 X 时按 1，功能等价于 "When I attack, give an enemy unit here -1 [M] this turn"；
 *   831.2 的官方示例正好是 Clanging Sentry——多个来源授予的 Disarm 值相加成一个触发
 *   （stacking: "sum"），因此这里声明不带 value 的 disarm，由关键词注册表按 831.2 求和。
 *
 * status 判定（README 第 2 节）：judge-required。缺口（复核 2026-10-17）：
 * 1. Disarm 的 KeywordDef 与 continuous.grant-keyword 指令均已合入；grant 半段有真实
 *    执行证据（本卡 golden 用生产链适配器执行 body，并断言 ability 图层的 disarm 登记、
 *    831.2 求和与回合结束到期）。
 * 2. 仍不能整卡执行：动态授予的 Disarm 关键词没有运行期的关键词 → attack-declared
 *    触发再展开 / 注册消费方（expandProgram 只展开 CardProgram 声明与 source.keywords，
 *    图层授予不会回流）。而且 attack-declared 时点本身也没有事件发射方——
 *    combat/flow.ts 在 staged combat 仍抛 combat-start-transaction（原子战斗事务；
 *    docs/rules/timing-point-producers.md 记为待后续）。生产对局因此
 *    不会为受授予的 Mech 安排该攻击触发。
 * 不近似实现。
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
    "「Your Mechs have [Disarm]」的 grant 半段已合入并有执行证据（continuous.grant-keyword；" +
    "Disarm KeywordDef 与 831.2 求和），golden 用生产链适配器真实执行 body 并断言" +
    "ability 图层的 disarm 登记、只作用于己方 Mech、以及回合结束到期。" +
    "静态程序绑定已经能把 CardProgram 的 static 能力注册成 ContinuousEffectSpec；" +
    "仍缺的是动态 grant-keyword 产生后，按 831.1.d 把 Disarm 再展开并注册到 attack-declared 的消费方，" +
    "且 attack-declared 时点尚无事件发射方（combat/flow.ts 抛 combat-start-transaction，" +
    "因此受授予的 Mech 在生产对局里不会安排该攻击触发。不近似实现。",
  abilities,
  sourceText:
    "Your Mechs have [Disarm]. (When each of us attacks, give an enemy unit there -1 :rb_might: this turn.)"
} satisfies CardProgram;

export default program;

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
 * status 判定（README 第 2 节）：judge-required。两处都已核对到当前缺口：
 * 1. Disarm 的 KeywordDef 与 continuous.grant-keyword 指令均已合入（RIFT-264 批次的关键词
 *    注册表、RIFT-258 持续效果指令），grant 半段有真实执行证据（本卡 golden 用生产链适配器
 *    执行 body，并断言 ability 图层的 disarm 登记 + 831.2 求和 + 回合结束到期）。
 * 2. 仍不能整卡执行：CardProgram 的 static 能力没有「程序绑定 → 图层注册」的消费方
 *    （RIFT-257 src/programs/ 仍在进行），所以生产对局里 Clanging Sentry 不会真的给己方
 *    Mech 注册这条持续授予；Disarm 自身的 831.1.d 攻击触发（attack-declared 时点）也同样
 *    需要该注册路径才能生效（时点已有生产者，见 docs/rules/timing-point-producers.md）。
 * 依赖：RIFT-257（卡牌程序绑定）。不近似实现。
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
    "「Your Mechs have [Disarm]」的 grant 半段已合入并有执行证据（continuous.grant-keyword，RIFT-258；" +
    "Disarm KeywordDef 与 831.2 求和，RIFT-264 批次的 keywords/Disarm.ts），golden 用生产链适配器真实执行 body 并断言" +
    "ability 图层的 disarm 登记、只作用于己方 Mech、以及回合结束到期。" +
    "仍缺的一步是卡牌程序绑定：没有消费方把 CardProgram 的 static 能力注册成 ContinuousEffectSpec" +
    "（ResolveContext.addContinuous 目前只被原语调用，src/programs/ 属 RIFT-257 仍在进行），" +
    "因此生产对局不会为 Clanging Sentry 注册这条授予，831.1.d 的攻击触发也不会展开。" +
    "依赖：RIFT-257（卡牌程序绑定）。不近似实现。",
  abilities,
  sourceText:
    "Your Mechs have [Disarm]. (When each of us attacks, give an enemy unit there -1 :rb_might: this turn.)"
} satisfies CardProgram;

export default program;

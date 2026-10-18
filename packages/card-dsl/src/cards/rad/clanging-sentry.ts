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
 * status 判定（README 第 2 节）：judge-required。缺口（2026-10-18 第四轮复核，逐项实测）：
 * 1. 授予半段仍可执行：continuous.grant-keyword 注册 ability 图层效果，Disarm 的
 *    KeywordDef 与 831.2 求和均在；本卡 golden 用真实解释器执行 body，并断言
 *    ability 图层的 disarm 登记、只作用于己方 Mech 与回合结束到期。
 * 2. RIFT-710 已合入 granted-keyword 再展开（programs/keyword-grants.ts 的
 *    KeywordGrantLayerEngine / expandEffectiveKeywords）。实测把「printed Disarm 3 +
 *    本卡授予 1」交给 expandEffectiveKeywords 得到单一 Disarm 4 与一条
 *    triggered:attack-declared 能力。但该引擎不是生产默认：ChainEngine 仍以
 *    new LayerEngine(...) 构造（实测 engine.layers.constructor.name === "LayerEngine"），
 *    programs/lifecycle.ts 也把 static 绑到该默认引擎，因此生产对局里授予的 Disarm
 *    不会回流成 attack-declared 触发。
 * 3. 即使把注册注入 KeywordGrantLayerEngine，动态展开仍 fail-closed：实测抛
 *    "Dynamic triggered keyword abilities need a lifecycle binder"（staticEffects
 *    只接受 static 展开）。Disarm 的 831.1.d 展开正是 triggered，仍缺生命周期绑定方。
 * 4. attack-declared 时点仍无事件发射方：combat/flow.ts 在 staged combat 抛
 *    combat-start-transaction（原子战斗事务；docs/rules/timing-point-producers.md
 *    记为「待后续」）。
 * 5. 同名关键词改写缺陷：默认 LayerEngine 的 applyKeyword 按精确 id 覆盖，实测
 *    printed 小写 disarm 3 + 本卡授予小写 disarm 1 读回 disarm 1（违反 831.2 求和）；
 *    printed 大写 Disarm 3 时两条并存、由 expandEffectiveKeywords 正确得到 Disarm 4。
 *    两种拼写都是数据可达形态，不能近似实现。
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
    "(2026-10-18 第四轮复核实测)「Your Mechs have [Disarm]」的授予半段已可执行：continuous.grant-keyword " +
    "注册 ability 图层效果（Disarm KeywordDef 与 831.2 求和），golden 用真实解释器断言只作用于" +
    "己方 Mech、以及回合结束到期。仍缺三处：" +
    "(1) RIFT-710 的再展开已合入（programs/keyword-grants.ts KeywordGrantLayerEngine / expandEffectiveKeywords），" +
    "实测「printed Disarm 3 + 本卡授予 1」求和为单一 Disarm 4 并产出 triggered:attack-declared 能力；" +
    "但该引擎不是生产默认——ChainEngine 仍构造 LayerEngine（实测 layers.constructor.name），" +
    "programs/lifecycle.ts 也把 static 绑到该默认引擎，故生产对局里授予的 Disarm 不会回流成攻击触发。" +
    "(2) 即使注入 KeywordGrantLayerEngine，Disarm 的 831.1.d triggered 展开实测 fail-closed：" +
    "\"Dynamic triggered keyword abilities need a lifecycle binder\"（staticEffects 只接受 static 展开）。" +
    "(3) attack-declared 时点无事件发射方：combat/flow.ts 抛 combat-start-transaction" +
    "（docs/rules/timing-point-producers.md 记为待后续）。" +
    "另有同名改写缺陷：默认 LayerEngine 的 applyKeyword 按精确 id 覆盖，实测 printed 小写 disarm 3 + 本卡授予 1 读回 disarm 1" +
    "（违反 831.2）；printed 大写 Disarm 3 时两条并存并由 expandEffectiveKeywords 正确得到 4，两种拼写均可达。不近似实现。",
  abilities,
  sourceText:
    "Your Mechs have [Disarm]. (When each of us attacks, give an enemy unit there -1 :rb_might: this turn.)"
} satisfies CardProgram;

export default program;

import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * K'Sante, Dauntless (rad-045-167) — Unit, 4 energy + 1 Calm power, 4 Might.
 *
 * 原文："[Shield] (+1 :rb_might: while I'm a defender.)\n"
 *       "When I attack or defend, double the [Shield] of a unit you control here this turn."
 *
 * 规则依据（CR v1.5）：
 * - 814.1 / 814.1.b.3 / 814.1.c：Shield 是被动能力关键词，省略 X 时按 1（"While I am a
 *   defender, I have +X [M]"）；卡上以 { kind: "keyword", keyword: "shield" } 声明，
 *   展开由 effects/keywords/Shield.ts 负责（该文件已合入）。
 * - "When I attack or defend"：383.4.e / 383.4.f 的攻击/防守触发（attack-declared /
 *   defense-declared 两个时点；466.2.c 战斗中后来取得身份也算）。
 * - "double the [Shield] of a unit you control here this turn"：把目标单位本回合的
 *   Shield 值加倍 = 对 Shield 关键词值的算术修改，属 arithmetic 层 + 本回合结束到期的
 *   持续效果（143.2.a / 475 / continuous.duration）。这里的 "[Shield]" 是 814.1.b 的
 *   Shield Value（814.2 说明多个 Shield 来源相加成一个 Shield 值）。
 *
 * status 判定（README 第 2 节）：judge-required。缺口：
 * 1. `continuous.might`（对 Might / 关键词值的 arithmetic 修改）+ `continuous.duration`
 *    没有已注册的卡牌侧原语；已合入的 effect.buff 只放 Buff counter（702），不是 Might 或
 *    Shield 值修改，LayerEngine 也只消费经 ResolveContext.addContinuous 注册的
 *    ContinuousEffectSpec（CardProgram static 未接线）；
 * 2. "double the [Shield]" 需要把"Shield 关键词值"作为可被持续效果算术修改的特征；
 *    LayerEngine 的 arithmetic 分支虽能在关键词上做增量，但没有卡牌侧入口。
 * 依赖：RIFT-91（layers-continuous）与后续 continuous.might / Shield 值修改原语批次。
 * golden 测试断言 Shield 关键词声明、双时点触发结构与目标过滤器，并以 test.todo 记录缺口。
 */

const SHIELD_UNIT_HERE = "ksante-dauntless.unit-here";

const grantShieldDoubling = (id: string): Ability => ({
  kind: "triggered",
  trigger: {
    at: id === "ksante-dauntless.attack" ? "attack-declared" : "defense-declared",
    filter: {
      event: id === "ksante-dauntless.attack" ? "attack-declared" : "defense-declared",
      filter: { source: "self" }
    }
  },
  optional: false,
  body: [
    {
      id,
      // 814.1.b 的 Shield Value 加倍（arithmetic 层，本回合到期）；原语未注册，见 judgeReason。
      op: "continuous.might",
      args: {
        // 814.1.b 的 Shield Value 加倍：arithmetic 层的乘法修改。
        mode: { kind: "constant", value: "multiply" },
        layer: { kind: "constant", value: "arithmetic" },
        amount: { kind: "constant", value: 2 },
        duration: { kind: "constant", value: "end-of-turn" },
        target: { kind: "constant", value: SHIELD_UNIT_HERE }
      },
      targets: [
        {
          id: SHIELD_UNIT_HERE,
          // "a unit you control here"：你控制的、与来源同处一个战场/基地的单位（464.2.b）。
          filter: {
            type: "unit",
            controller: "controller",
            zone: "board",
            sameLocationAs: "self"
          },
          min: 1,
          max: 1,
          selection: "one"
        }
      ]
    }
  ]
});

const abilities: Ability[] = [
  // 814.1.b.3：印刷的 [Shield] 省略值，按 1 处理。
  { kind: "keyword", keyword: "shield" },
  grantShieldDoubling("ksante-dauntless.attack"),
  grantShieldDoubling("ksante-dauntless.defend")
];

const program = {
  canonicalCardId:
    "card.hash-5d66044d59f3bf4f17b4143a7229c8e12673e34e92591de0005f64fad8dd2a82",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "「double the [Shield] of a unit you control here this turn」需要把单位本回合的 Shield 值（814.1.b/814.2）" +
    "在 arithmetic 层加倍并到期于回合结束，属 continuous.might + continuous.duration；这两个卡牌侧原语" +
    "尚未注册（effect.buff 只放 Buff counter，LayerEngine 也只消费 ResolveContext.addContinuous 注册的" +
    "持续效果，CardProgram static 未接线）。依赖：RIFT-91（layers-continuous）与后续 " +
    "continuous.might / Shield 值修改原语批次。[Shield] 关键词本身由已合入的 effects/keywords/Shield.ts " +
    "负责展开（814）。不近似实现：不把 Shield 加倍写成 Buff counter 或临时 Might 修改之外的语义。",
  abilities,
  sourceText:
    "[Shield] (+1 :rb_might: while I'm a defender.)\n" +
    "When I attack or defend, double the [Shield] of a unit you control here this turn."
} satisfies CardProgram;

export default program;

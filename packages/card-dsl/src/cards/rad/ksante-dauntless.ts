import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * K'Sante, Dauntless (rad-045-167) — Unit, 4 energy + 1 Calm power, 4 Might.
 *
 * 原文（packages/card-data/data/deck-catalog.json，sourceText 逐字）：
 *   "[Shield] (+1 :rb_might: while I'm a defender.)\n"
 *   "When I attack or defend, double the [Shield] of a unit you control here this turn."
 *
 * 规则依据（CR v1.5）：
 * - 814.1 / 814.1.b.3 / 814.1.c：Shield 是被动能力关键词，省略 X 时按 1（"While I am a
 *   defender, I have +X [M]"）；卡上以 { kind: "keyword", keyword: "shield" } 声明，
 *   展开由 effects/keywords/Shield.ts 负责（该文件已合入）。
 * - "When I attack or defend"：383.4.e / 383.4.f 的攻击/防守触发（attack-declared /
 *   defense-declared 两个时点；466.2.c 战斗中后来取得身份也算）。
 * - "double the [Shield] of a unit you control here this turn"：把目标单位本回合的
 *   Shield 值加倍 = 对 Shield 关键词值的算术修改，属 arithmetic 层 + 本回合结束到期的
 *   持续效果（143.2.a / 475）。这里的 "[Shield]" 是 814.1.b 的 Shield Value
 *   （814.2 说明多个 Shield 来源相加成一个 Shield 值）。
 *
 * status = judge-required（逐个缺口写出证据，不近似实现）：
 * 1. 卡牌侧没有可用的“把关键词取值倍增”的 continuous 指令：已合入的 continuous.might
 *    只做 Might 的 add/set（478.1.a 的 arithmetic 修改），argsSchema 不接受 multiply
 *    或 layer 字段（直接抛出 “Invalid continuous.might argument”）；continuous.grant-keyword
 *    的 value 是“新增一则带值关键词”，也不是倍增。LayerEngine 的 applyArithmetic 有
 *    multiply/double 分支，但只识别 kind 里含 "multiply"/"double" 的连续效果，且没有
 *    卡牌可写的入口（乘的是 snapshot.might，不是 Shield 关键词值）。
 * 2. Shield 的展开本身也没有消费者：effects/keywords/Shield.ts 已合入，但卡牌 static →
 *    图层的注册方不存在（RIFT-257 + RIFT-91）；其 condition 依赖的 designation 特征不在
 *    ObjectSnapshot 里（contract 3.8 的 combatRole 未落地），且 layers/engine.ts 的
 *    conditionMatches 对未知条件默认返回 true，直接把 +X Might 常驻化是错误语义。
 * 依赖：RIFT-261/257（费用与卡程序/图层绑定）与“关键词取值倍增”的 continuous 原语批次。
 * golden 只锁定已合入的 Shield 声明、双时点触发结构与真实执行不了的部分（见 test）。
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
      // 814.1.b 的 Shield Value 加倍（arithmetic 层，本回合到期）；见 judgeReason 第 1 点。
      op: "continuous.might",
      args: {
        // 语义：arithmetic 层的 Shield 值倍增。合并的 continuous.might 不接受 multiply，
        // 此处保留有依据的声明形状，不写成 +N 或 set 这类近似。
        mode: { kind: "constant", value: "multiply" },
        layer: { kind: "constant", value: "arithmetic" },
        amount: { kind: "constant", value: 2 },
        duration: { kind: "constant", value: "end-of-turn" },
        objects: {
          kind: "constant",
          value: { kind: "target", id: SHIELD_UNIT_HERE }
        }
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
    "「double the [Shield] of a unit you control here this turn」需要把单位本回合的 Shield 值（814.1.b/814.2）在 " +
    "arithmetic 层倍增。合并的 continuous.might 只做 Might 的 add/set（argsSchema 直接拒绝 multiply/layer 字段：" +
    "Invalid continuous.might argument），continuous.grant-keyword 的 value 是新增一则带值关键词而非倍增；LayerEngine 的 " +
    "multiply/double 分支只认 kind 含 multiply/double 的连续效果、且乘的是 Might 而非 Shield 关键词值，没有卡牌可写入口。" +
    "另外 effects/keywords/Shield.ts 的展开虽已合入，但卡牌 static → 图层的注册方不存在（RIFT-257 + RIFT-91），其 condition 依赖的 " +
    "designation 特征不在 ObjectSnapshot 里（contract 3.8 的 combatRole 未落地），layers/engine.ts 的 conditionMatches 对未知条件" +
    "默认返回 true——直接接线会把 +X Might 常驻化，属错误语义。依赖：RIFT-261/257（费用与卡程序/图层绑定）与「关键词取值倍增」的" +
    "continuous 原语批次。不近似实现（不写成 +N 或 set Might）。",
  abilities,
  sourceText:
    "[Shield] (+1 :rb_might: while I'm a defender.)\n" +
    "When I attack or defend, double the [Shield] of a unit you control here this turn."
} satisfies CardProgram;

export default program;

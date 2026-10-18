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
 * status = judge-required（2026-10-18 复核，逐个缺口实测，不近似实现）：
 * 1. 卡牌侧没有“把关键词取值倍增”的 continuous 指令：已合入的 continuous.might
 *    只做 Might 的 add/set（478.1.a 的 arithmetic 修改），argsSchema 拒绝 layer 字段
 *    （实测 “Invalid continuous.might argument: layer”）、运行时拒绝 mode multiply
 *    （实测 “continuous.might mode must evaluate to \"add\" or \"set\"”）；continuous.keyword
 *    的参数表没有 mode/multiply，只有 keyword/value/keywords（增补一类带值关键词），
 *    实测对 Shield 3 追加 keyword 3 只会把该关键词值改成 6，不是 814.1.b 的“当前 Shield 值 × 2”。
 *    LayerEngine 的 applyArithmetic 确有 multiply/double 分支（layers/engine.ts），
 *    但它只对 kind 里含 multiply/double 的连续效果生效且乘的是 snapshot.might，
 *    没有卡牌可写的入口能改关键词值（814.2 的 Shield Value）。
 * 2. Shield 的展开与静态绑定已经合入，但展开条件读 object-property(self, "designation")，
 *    而 ObjectSnapshot 只有 combatRole：基础求值器抛 MissingInformation
 *    （实测 “Unavailable characteristic: designation”），bindStaticToLayers 的条件包装
 *    捕获后恒为 false（实测生产 binder 登记 continuous.might 但 layers.evaluate() 仍是印刷 Might）。
 *    判别式属 engine-core 的 keywords/Shield.ts，不在本任务写域。
 * 3. "a unit you control here" 在生产绑定链上不可表达：卡牌侧 IR 的 filter.sameLocationAs
 *    能通过 validateCardProgram（实测 ok），解释器的 queryObjects 也支持该锚点
 *    （实测「同处一个战场」计数为真），但 programs/filters.ts 的 translateObjectFilter
 *    白名单不含该键，translateInstructionTargets 对 body 目标直接抛
 *    ProgramBindingError “Unsupported filter field sameLocationAs”。另一条路
 *    target.location 也不行：validateTarget 只把 {type:"battlefield",id} 或具体 base 交回
 *    validateLocationSelector，其余一律落到 validateLocationFilter，因此 359.3.f 的
 *    {kind:"relative",relation:"source-location"} / {kind:"location-of",object:"self"}
 *    实测被判 invalid-location-kind。生产链写不出「与来源同处一个战场」。
 * golden 锁定已合入的 Shield 声明、双时点触发结构，以及上述三处实测边界（见 test）。
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
    "三处当前真实缺口（2026-10-18 实测）：" +
    "(1)「double the [Shield] of a unit you control here this turn」要把单位本回合的 Shield 值（814.1.b/814.2）" +
    "在 arithmetic 层倍增，但卡牌侧没有该入口：continuous.might 的 argsSchema 拒绝 layer 字段、" +
    "运行时拒绝 mode multiply（只接受 add/set）；continuous.keyword 只做「增补带值关键词」，" +
    "实测对既有 Shield 追加固定值得到的是相加结果（printed 3 + grant 3 = 6、printed 5 + grant 3 = 8），" +
    "等于真正倍增只在印刷值恰好等于增量时巧合成立，不能作为加倍语义；其 value 也只接受非负整数，" +
    "不能引用当前关键词值。LayerEngine 的 multiply/double 分支只认 kind 含 multiply/double 的连续效果" +
    "且作用在 snapshot.might 上，没有改写关键词值的卡牌侧入口。" +
    "需要的语义：把关键词当前值按倍率计算的 continuous 入口（814.2 Shield Value；具体 op 由契约确认）。" +
    "(2) Shield（814.1.c）展开为 arithmetic 的 continuous.might，条件读 object-property(self, \"designation\")，" +
    "而 ObjectSnapshot 只提供 combatRole：基础求值器抛 MissingInformation（实测 “Unavailable characteristic: designation”），" +
    "bindStaticToLayers 捕获后条件恒 false，生产 binder 登记成功但 layers.evaluate() 仍返回印刷 Might。" +
    "依赖：keywords/Shield.ts 的 designation/combatRole 判别式修正（engine-core 写域外）。" +
    "(3)「a unit you control here」的 here 过滤在生产绑定链不可表达：IR 的 filter.sameLocationAs 通过" +
    "validateCardProgram，解释器 queryObjects 也支持该锚点（同处一个战场的计数实测为真），" +
    "但 programs/filters.ts 的 translateObjectFilter 白名单不含该键，translateInstructionTargets 对 body 目标" +
    "抛 ProgramBindingError “Unsupported filter field sameLocationAs”；target.location 的相对选择器" +
    "（359.3.f 的 source-location）则被 validateTarget 判 invalid-location-kind。" +
    "缺口关闭前不近似实现（不写成 +N 或 set Might，也不手写 Shield 加成）。",
  abilities,
  sourceText:
    "[Shield] (+1 :rb_might: while I'm a defender.)\n" +
    "When I attack or defend, double the [Shield] of a unit you control here this turn."
} satisfies CardProgram;

export default program;

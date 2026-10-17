import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Lucian, Gunslinger (sfd-028-221) — Unit, Fury, Lucian/Demacia/Sentinel/Champion.
 * energy 3, power: none printed, Might 2.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, sfd-028-221，逐字，含换行）:
 *   "[Assault] (+1 :rb_might: while I'm an attacker.)\n"
 *   "When I attack, deal damage equal to my [Assault] to an enemy unit here."
 *
 * 规则依据（CR v1.5）:
 * - [Assault]（807.1.b.3）：未印刷数值时视为 Assault 1；卡内只声明 keyword（契约 3.7），
 *   展开（continuous.might + Attacker 条件）由 effects/keywords/Assault.ts 负责。
 * - "When I attack"：383.4.e 的 Attack Trigger，时点 attack-declared（383.4.e.2 规定在
 *   单位取得 Attacker 身份后进链）；filter 用内层 source: "self" 指称本卡。
 * - "deal damage equal to my [Assault]"：伤害数额在结算时读取本卡的 Assault 数值
 *   （807.1.b.2 定义 Assault Value，807.2 要求叠加授予值，807.3 允许引用）。
 *   effects/interpreter/expr.ts 的 object-property 只读取快照直接属性，不能从 keywords
 *   数组读取当前 Assault Value；不能用默认值 1 代替结算时数值（359.3.f.2）。
 * - "an enemy unit here"：「enemy」= 对手控制（740.1.b），「here」= 本卡所在地点
 *   （359.3.f.1/.2），写成 TargetSpec 的 controller/sameLocationAs 过滤（355.9.b）。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required（复核 2026-10-17）。
 * - effects/keywords/Assault.ts 与 expandProgram 已合入，programs/statics.ts 的生产
 *   binder 能登记 continuous.might；但展开条件读取 designation，ObjectSnapshot 提供的
 *   是 combatRole，条件求值缺少该属性，binder 捕获异常后返回 false，攻击加成未生效；
 * - ``damage equal to my [Assault]`` 需要在结算时读取关键词的 Assault Value
 *   （807.1.b.2/807.2/807.3）。``keywords.assault.value`` 只是描述性占位路径；
 * - CardProgram/ChainEngine 路径中的 combat/flow.ts 在开启战斗/转换 showdown 时分别抛
 *   combat-start-transaction/showdown-conversion，缺少授予 Attacker 后发射 attack-declared
 *   并按每场战斗首次取得身份触发的生产路径（383.4.e.2/.2.a、466.2.c.3/.d）；
 * - sameLocationAs 已由解释器查询和静态效果 binder 支持，但 programs/filters.ts 的
 *   translateInstructionTargets → translateObjectFilter 仍拒绝该字段，触发 body 的
 *   TargetSpec 无法进入生产绑定，也就无法按来源结算时的位置重验目标（359.3.f.2）。
 * 上述缺口仍在；保持 judge-required，不把局部伤害原语测试当成整卡执行证据。
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "assault" },
  {
    kind: "triggered",
    trigger: {
      at: "attack-declared",
      filter: { event: "attack-declared", filter: { source: "self" } }
    },
    optional: false,
    body: [
      {
        id: "lucian-gunslinger.damage",
        op: "effect.damage",
        args: {
          // 描述性占位：结算时应等于本卡当前的 Assault Value。
          // Expr 尚无关键词值选择器，故不能写成常量 1 冒充。
          amount: {
            kind: "object-property",
            object: "source",
            property: "keywords.assault.value"
          },
          target: { kind: "constant", value: "lucian-gunslinger.enemy-unit-here" }
        },
        targets: [
          {
            id: "lucian-gunslinger.enemy-unit-here",
            filter: { type: "unit", controller: "opponent", sameLocationAs: "source" },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-9cbd19f7b3430a1dd398620ef97b933b43283fd7e9514a877188b5aa5d1cd80a",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "缺 Assault 展开条件与快照特征的映射：effects/keywords/Assault.ts 读取 designation，" +
    "ObjectSnapshot 提供 combatRole；programs/statics.ts 捕获条件求值异常后返回 false，" +
    "已合入的 continuous.might binder 因而无法施加攻击加成（807.1.c/807.1.d.1）。" +
    "缺 CardProgram/ChainEngine 的攻击触发生产路径：combat/flow.ts 仍以 " +
    "combat-start-transaction/showdown-conversion 阻止战斗开启/转换，尚未在授予 Attacker 后发射 " +
    "attack-declared 并按每场战斗首次取得身份触发（383.4.e.2/383.4.e.2.a、466.2.c.3/466.2.d）。" +
    "缺触发 body 的 TargetSpec sameLocationAs 生产翻译：解释器查询与静态效果 binder 已支持它，" +
    "但 programs/filters.ts 的 translateInstructionTargets → translateObjectFilter 仍拒绝该字段，" +
    "不能绑定并重验“enemy unit here”（355.9.b/359.3.f.2）。" +
    "缺关键词数值 Expr：effects/interpreter/expr.ts 的 object-property 只读取快照直接属性，" +
    "不能从 keywords 数组读取结算时含叠加授予的 Assault Value；keywords.assault.value 仍是占位路径" +
    "（359.3.f.2、807.1.b.2/807.2/807.3），不能用常量 1 近似。",
  abilities,
  sourceText:
    "[Assault] (+1 :rb_might: while I'm an attacker.)\n" +
    "When I attack, deal damage equal to my [Assault] to an enemy unit here."
} satisfies CardProgram;

export default program;

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
 *   （807.1.b.2 定义 Assault Value 是可引用特征，807.3）。当前没有表达式可读取某对象
 *   的关键词数值（Expr 无 keyword-value 形态），因此不能静态写出该 amount。
 * - "an enemy unit here"：「enemy」= 对手控制（740.1.b），「here」= 本卡所在地点
 *   （449/421.1），写成 TargetSpec 的 controller/sameLocationAs 过滤（355.9.b）。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required（复核 2026-10-17）。
 * - [Assault] 的 KeywordDef 与 expandProgram 展开已合入，生产 static binder 也能登记
 *   continuous.might；但展开条件读取 designation，而 ObjectSnapshot 只提供 combatRole，
 *   条件会因缺少该特征而 fail-closed，攻击期间的 +1 Might 仍不会生效；
 * - ``damage equal to my [Assault]`` 需要在结算时读取关键词的 Assault Value
 *   （807.1.b.2/807.3）。Expr 只能读取 ObjectSnapshot 的直接属性，keywords 是数组且没有
 *   keyword-value 选择器；``keywords.assault.value`` 只是保留缺口的描述性路径，不能改成
 *   常量 1 来近似；
 * - attack-declared 已进入时点词表，触发注册器也存在，但 combat/flow.ts 在战斗开启的
 *   原子事务处抛 combat-start-transaction，尚无 Attacker designation 或该时点的生产发射；
 *   正文目标的 sameLocationAs 锚点虽由解释器查询支持，programs/filters.ts 仍拒绝它，
 *   因而生产 TargetSpec 无法绑定“enemy unit here”。
 * 依赖：combatRole/designation 条件映射与 attack-declared 生产路径、关键词数值 Expr、
 * TargetSpec sameLocationAs 的生产翻译。不近似实现。
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
    "[Assault] 的 KeywordDef/expandProgram 展开和 continuous.might static binder 已合入，" +
    "但展开条件读取 designation；当前 ObjectSnapshot 只提供 combatRole，生产条件求值会 fail-closed，" +
    "故 807.1.c/.d.1 的攻击期间 +1 Might 尚未生效。" +
    "attack-declared 已在时点词表和触发注册器中，但 combat/flow.ts 在战斗开启的原子事务处抛 " +
    "combat-start-transaction，尚无 Attacker designation 或该时点的生产发射（383.4.e/466.2.c）。" +
    "正文的 sameLocationAs 查询由解释器支持，programs/filters.ts 的生产翻译器却拒绝该字段，" +
    "所以 TargetSpec 不能绑定“enemy unit here”（355.9.b/359.3.f）。" +
    "“damage equal to my [Assault]”还缺关键词数值 Expr：Expr 只能读取 ObjectSnapshot 直接属性，" +
    "keywords 数组没有 Assault Value 选择器（807.1.b.2/807.3），不能写成常量 1 近似。" +
    "依赖：combatRole/designation 条件映射与 attack-declared 生产路径、关键词数值 Expr、" +
    "TargetSpec sameLocationAs 的生产翻译。不近似实现。",
  abilities,
  sourceText:
    "[Assault] (+1 :rb_might: while I'm an attacker.)\n" +
    "When I attack, deal damage equal to my [Assault] to an enemy unit here."
} satisfies CardProgram;

export default program;

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
 * status 判定（cards/README.md 第 2 节）：judge-required。
 * - [Assault] 展开虽由 Assault.ts 提供，但没有消费方把卡牌程序的 keyword 能力展开并注册
 *   进图层，图层也不读取 Attacker designation（ObjectSnapshot 无 combatRole/designation）；
 * - ``damage equal to my [Assault]`` 缺「读取关键词数值」的表达式形态，不能写成常量 1 或
 *   object-property 的伪属性来近似；
 * - attack-declared 时点尚无发射方（combat/ 未把 Attacker 身份接入事件管线）；
 *   「here」的 sameLocationAs 锚点由解释器支持，但触发 filter 的内层锚点尚无消费方。
 * 依赖：RIFT-81/RIFT-91（关键词展开与图层）、关键词数值表达式、attack-declared 发射路径
 * （RIFT-33/RIFT-120）。不近似实现。
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
          // 描述性占位：结算时应等于本卡的 Assault Value。
          // 现有 Expr 形态读不到关键词数值，故不能写成常量 1 冒充。
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
    "「deal damage equal to my [Assault]」缺可执行路径：没有表达式能读取某对象的关键词数值" +
    "（807.1.b.2 的 Assault Value 可被引用，但 Expr 只有 constant/literal/object-property/linked/count/arithmetic，" +
    "ObjectSnapshot 的 keywords 数组没有取值形态），不能写成常量 1 近似；" +
    "[Assault]（807）的展开文件 effects/keywords/Assault.ts 虽已合入，但没有消费方把卡牌程序的 keyword 能力展开并注册进图层，" +
    "layers（RIFT-91）也不读取 Attacker designation（ObjectSnapshot 无 combatRole/designation，契约 3.8 只冻结字段设计）；" +
    "attack-declared 时点（383.4.e）尚无发射方（combat/ 未接入事件管线）。" +
    "依赖：关键词数值表达式、RIFT-81/RIFT-91（关键词展开与图层）、attack-declared 发射路径（RIFT-33/RIFT-120）。不近似实现。",
  abilities,
  sourceText:
    "[Assault] (+1 :rb_might: while I'm an attacker.)\n" +
    "When I attack, deal damage equal to my [Assault] to an enemy unit here."
} satisfies CardProgram;

export default program;

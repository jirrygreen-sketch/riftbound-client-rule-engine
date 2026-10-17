import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Ancient Warmonger (sfd-131-221) — Unit, Chaos, tags Spirit/Noxus.
 * energy 5, power: none printed, Might 4.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, sfd-131-221，逐字，含换行）:
 *   "[Accelerate] (You may pay :rb_energy_1::rb_rune_chaos: as an additional cost to have me enter ready.)\n"
 *   "I have [Assault] equal to the number of enemy units here. (+1 :rb_might: while I'm an attacker for each instance of Assault.)"
 *
 * 规则依据（CR v1.5）：
 * - [Accelerate]（805）：可选附加费用关键词，805.1.b 规定费用固定为 1 energy + 1 power
 *   （本卡为 Chaos 域的 [C]，805.1.b.1 要求 Power 与单位某一域匹配）；805.4 规定多份
 *   Accelerate 冗余（stacking "single"）；805.6/805.6.a 是付费后的入场就绪替代。卡内只声明
 *   { kind: "keyword", keyword: "accelerate" }（契约 3.7/README 第 5 节），展开由已合入的
 *   effects/keywords/Accelerate.ts 负责。
 * - "I have [Assault] equal to the number of enemy units here"：这是把 Assault 授予自身、
 *   数值等于「此处敌方单位数」的动态关键词授予；807.1.b.2 规定 Assault Value 可被功能文本
 *   引用，807.3 说明「是否拥有 Assault」是可读取特征。
 * - reminder 括号（“+1 :rb_might: while I'm an attacker for each instance of Assault.”）是
 *   807.1.c 的释义（Assault 在攻击时按每份 +1 Might），不是独立指令。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required。三处当前缺口：
 * - 静态绑定本身可以把 appliesTo:self 的 ability 层效果登记进图层；真正缺口在动态值：
 *   static binder 会保留嵌套的 count 表达式，但 layers/engine.ts 的 applyAbility
 *   把原始 effect.value 交给只接受整数的 keywordValue；valueOf 也不求值 count，
 *   因此授予值不会变成此处敌方单位数。
 * - 即使动态数值可读，运行时授予的 Assault 仍需要 KeywordDef/Assault 消费路径把 ability 层关键词
 *   展开成攻击者期间的 Might；现有 Assault 展开读取 designation，而 ObjectSnapshot 提供 combatRole，
 *   特征字段也未对齐。
 * - [Accelerate] 的 KeywordDef 已展开出 accelerate.cost 与入场替代；替代绑定器能消费
 *   effect.ready，但 programs/statics.ts 没有 accelerate.cost 的图层映射，且
 *   programs/play.ts 的 translateCost / Finalize 不会从该静态效果收集 optionalAdditional。
 * 依赖：ability 图层动态 count 求值、运行时授予 Assault 的消费与 designation/combatRole 对齐、
 * Accelerate 静态费用到 Finalize optionalAdditional 的生产接线。
 * 不近似实现（不把动态数值写成固定 Assault、不把手写展开塞进卡程序）。
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "accelerate" },
  {
    kind: "static",
    effect: {
      // 契约 3.7 模板中的 continuous.grant-keyword：把 Assault 授予本卡，
      // 数值为「此处敌方单位数」。static binder 可登记自身效果，但动态
      // count 仍需 ability 图层的数值消费（见 judgeReason）。
      kind: "continuous.grant-keyword",
      appliesTo: "self",
      keyword: "assault",
      // 806/807.1.b.2：授予值是动态计数——「敌方单位在此战场的数量」。
      // sameLocationAs 锚点指称本卡所在地点（449/421.1 的 Location）。
      value: {
        kind: "count",
        subject: "units",
        filter: {
          type: "unit",
          controller: "opponent",
          zone: "board",
          sameLocationAs: "self"
        }
      }
    }
  }
];

const program = {
  canonicalCardId: "card.hash-3657fb1a42b929920135ba38e292bf53fa1112a145cf12bb352cd750e3b64e60",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "「I have [Assault] equal to the number of enemy units here」的动态关键词授予有三处当前真实缺口：" +
    "(1) static binder 可以登记 appliesTo:self 的 ability 层效果，但会保留嵌套 count 表达式，" +
    "layers/engine.ts 的 applyAbility 把原始 effect.value 交给只接受整数的 keywordValue，" +
    "valueOf 也不求值 kind:\"count\"，所以授予值不会变成此处敌方单位数；" +
    "(2) 运行时授予的 Assault 还没有进入 KeywordDef/Assault 消费路径，且 Assault 展开读取 designation、" +
    "ObjectSnapshot 提供 combatRole，807.1.d 的攻击者期间 Might 条件无法完成字段对齐；" +
    "(3) [Accelerate]（805）的 KeywordDef 已展开出 accelerate.cost 与入场替代，替代绑定器能消费 effect.ready，" +
    "但 programs/statics.ts 没有 accelerate.cost 的图层映射，programs/play.ts 的 translateCost / Finalize 也不会从该静态效果" +
    "收集 optionalAdditional，因此 805.1.b 的费用选择仍没有卡牌生产接线。" +
    "数值本身是动态计数（此处敌方单位数），不能用静态的 { keyword: \"assault\", value: N } 冒充。" +
    "依赖：layers 动态 count 求值、运行时授予关键词的 Assault 消费与 designation/combatRole 对齐、" +
    "Accelerate 静态费用到 Finalize 的接线。不近似实现（动态数值不写成固定 Assault、" +
    "不把关键词展开手写进卡程序）。",
  abilities,
  sourceText:
    "[Accelerate] (You may pay :rb_energy_1::rb_rune_chaos: as an additional cost to have me enter ready.)\n" +
    "I have [Assault] equal to the number of enemy units here. (+1 :rb_might: while I'm an attacker for each instance of Assault.)"
} satisfies CardProgram;

export default program;

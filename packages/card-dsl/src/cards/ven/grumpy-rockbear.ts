import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Grumpy Rockbear (ven-050-166) — Unit, Mind, Shurima.
 *
 * 原文：
 *   [Empower] :rb_energy_12:. This ability costs :rb_energy_1: less for each rune
 *   you control. (Pay the cost: Empower me. Use only if not Empowered.)
 *   [Empowered][>] I have [Deflect] and [Shield 3]. (Opponents must pay
 *   :rb_rune_rainbow: to choose me with a spell or ability.+3 :rb_might: while
 *   I'm a defender.)
 *
 * 规则依据（Core Rules v1.5）：
 * - 827.1：Empower 是 Activated Ability 关键词；827.1.c 规定格式 "Empower
 *   [Cost]"，本卡印刷费用为 12 Energy。827.1.c.3 明确 Empower 能力也可以带有修改
 *   Empower 费用的文本，任何需要确定该卡 Empower 费用的场合都要计入；206.1 说明
 *   需要判定某个能力费用时使用它的基础费用，除非文本另行说明——本卡正是"另行说明"，
 *   所以 "This ability costs 1 less for each rune you control" 是这条 Empower
 *   起动费用的一部分，不是独立效果。
 *   契约 3.8.3 把 params 放在 KeywordDef.expand 的输入上（供关键词注册表承载印刷
 *   参数），而契约 3.1 的 CardProgram KeywordAbility 只有 keyword / value 两个
 *   字段，卡程序无法把印刷参数直接挂在该能力上（TS 严格类型会拒绝）。因此这里把
 *   印刷费用 12 留在 keyword，把费用改写写成一条指向该 Empower 费用的 static 持续
 *   效果（appliesTo: "empower-activation-cost"、per: "rune-you-control"），由
 *   关键词 / 费用系统消费；不改 IR 类型，并在任务回复里登记该参数承载方式的契约
 *   变更请求。
 * - 442.1/442.2：Empower 把 Board 上的 Game Object 变为 Empowered；827.1.b.1
 *   规定来源本身不是目标。
 * - 828.1 / 828.1.b / 828.1.c / 828.1.d："[Empowered][>]" 之后的整句是
 *   Dependent Ability，条件为"只要我拥有 Empowered 状态"；727.1.b.1 说明该能力
 *   仍然写在卡上，只是按条件判断是否 Active。
 * - "I have [Deflect]"：809.1.b.3 规定省略 Deflect Value 时按 1；"and
 *   [Shield 3]"：814.1.b.3 规定省略时按 1、本卡写明 3（814.1.c 为 "while I am a
 *   defender, I have +X [M]"）。两者都是授予自身的被动关键词，按 Shield.ts /
 *   Assault.ts 的图层约定用 appliesTo: "self" 表达。
 *
 * 结构说明：
 * - 关键词只声明，不重写展开（契约 3.7 / README 第 5 节）。
 * - Empowered 门控用显式谓词占位（"empowered"），由 condition.predicate 与关键词
 *   系统消费；本程序不手写状态判定，也不把依赖能力改成无条件能力。
 */
const abilities: Ability[] = [
  {
    kind: "keyword",
    keyword: "empower",
    value: 12
  },
  {
    // 827.1.c.3 / 206.1：Empower 费用的改写文本，只在确定该 Empower 起动费用时计入
    kind: "static",
    effect: {
      kind: "continuous.cost-modification",
      resource: "energy",
      appliesTo: "empower-activation-cost",
      per: "rune-you-control",
      minimum: 0,
      value: {
        kind: "count",
        subject: "runes",
        filter: { type: "rune", controller: "self", zone: "rune-zone" }
      }
    }
  },
  {
    kind: "static",
    effect: {
      kind: "continuous.grant-keyword",
      appliesTo: "self",
      keywords: [
        { id: "deflect", value: 1 },
        { id: "shield", value: 3 }
      ]
    },
    condition: {
      kind: "expression",
      value: { kind: "constant", value: "empowered" }
    }
  }
];

export default {
  canonicalCardId: "card.hash-1318a3352539e807f9e1630c856d2c196aa0c08582d7d3c992b230a01f6fe243",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺三块已合入能力：(1)「[Empower] 12」与它的费用改写没有 KeywordDef（RIFT-83/84 关键词展开；" +
    "827.1.c.1 的 cost.activated + effect.empower、827.1.c.3 的 Empower 费用改写、827.1.c.5 的" +
    "「仅未 Empowered 时可起动」限制均无实现）；(2)「[Empowered][>]」的 dependent-ability 门控" +
    "（828.1.c）需要 condition.predicate 的 empowered 谓词与关键词系统判断 Active，当前 Condition " +
    "没有该谓词；(3)「I have [Deflect] and [Shield 3]」是 continuous.grant-keyword 图层效果，" +
    "layers/ 尚未消费该 kind，且被授予的 Deflect 还需要 target.tax 图层消费方（RIFT-90）与关键词" +
    "注册表接通（RIFT-91 layers-continuous）。不近似实现费用改写与状态门控，不把依赖能力写成无条件" +
    "能力。",
  abilities,
  sourceText:
    "[Empower] :rb_energy_12:. This ability costs :rb_energy_1: less for each rune you control. (Pay the cost: Empower me. Use only if not Empowered.)\n" +
    "[Empowered][>] I have [Deflect] and [Shield 3]. (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.+3 :rb_might: while I'm a defender.)"
} satisfies CardProgram;

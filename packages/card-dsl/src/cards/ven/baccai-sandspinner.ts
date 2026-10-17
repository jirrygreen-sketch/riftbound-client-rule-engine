import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Baccai Sandspinner (ven-001-166) — Unit, Fury, tag Shurima.
 * energy 6, power: none printed, Might 6.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-001-166，逐字）：
 *   [Empower] :rb_energy_5:. This ability costs :rb_energy_3: less if you control 4
 *   or fewer runes. (Pay the cost: Empower me. Use only if not Empowered.)
 *   [Empowered][>] I have [Deflect] and [Assault 2]. (Opponents must pay
 *   :rb_rune_rainbow: to choose me with a spell or ability. +2 :rb_might: while
 *   I'm an attacker.)
 *
 * 规则依据（Core Rules v1.5）：
 * - 827.1 / 827.1.c / 827.1.c.1：Empower 是启动能力关键词，印刷费用为 5 Energy；
 *   功能上等价于 “5: Empower this。仅当未 Empowered 时启动”。827.1.b.1 规定来源
 *   本身不是该能力的目标。
 * - 827.1.c.3 / 206.1：Empower 能力可以带有改写其费用的文本，任何需要确定该卡
 *   Empower 费用的场合都必须计入；因此 “This ability costs 3 less if you control 4
 *   or fewer runes” 是这条 Empower 起动费用的一部分，不是独立效果。
 * - 133.5.a.1 / 431.1：被 channel 的符文留在控制者的符文区（zone "rune-zone"），
 *   所以 “you control 4 or fewer runes” = 控制者符文区的 rune 数量 <= 4。
 * - 828.1 / 828.1.b / 828.1.c：“[Empowered][>]” 之后的整句是 Dependent Ability，
 *   只在宿主拥有 Empowered 状态时 Active；828.1.b.1 明确它等价于 “While I have the
 *   Empowered status, this card gains '[Text]'”。
 * - 807.1 / 807.1.b / 807.1.c：[Assault 2] 是 “While I am an attacker, I have +2 [M]”
 *   的被动关键词（省略数值按 1，本卡写明 2）。关键词只声明不重写（契约 3.7）。
 * - 809.1 / 809.1.b.3 / 809.2：[Deflect] 同为被动关键词，省略数值按 1；
 *   括号内文字是提醒文本，不构成额外能力。
 *
 * status = judge-required（四处依赖都不近似实现）：
 * 1. effects/keywords/ 没有 Empower/Empowered 的 KeywordDef（注册表里无该条目）：
 *    827.1.c.1 的启动费用与 827.1.c.5 的 “Use only if not Empowered” 限制都没有展开
 *    路径，programs/keywords.ts 的 expandProgram 在缺 KeywordDef 时直接 judge-required。
 * 2. 费用改写没有消费方：cost/cost-plan.ts 只在调用方显式传入 discounts 时应用折扣，
 *    没有任何模块读取卡程序的 continuous.cost-modification 并把它接到 Empower 起动
 *    费用上。
 * 3. 828.1.c 的状态门控需要 empowered 谓词：ObjectSnapshot 没有该字段，测试内核的
 *    empowered 计数也不进入快照，condition.predicate 无法求值（RIFT-359）。
 * 4. “I have [Deflect] and [Assault 2]” 的授予原语 continuous.grant-keyword 已合入，
 *    但 Empower/Empowered 本体仍缺 KeywordDef，被授予的 Deflect 还需要 809.1.c 的
 *    目标税（target.tax 未注册，RIFT-360）。
 * 已支持部分：授予原语用 grumpy-rockbear 同款 golden 真实执行；印刷的 “4 or fewer
 * runes” 计数条件（133.5.a.1/431.1）由真实解释器 + 参考内核求值。其余依赖保持
 * test.todo。不近似实现。
 */
const abilities: Ability[] = [
  {
    kind: "keyword",
    keyword: "empower",
    value: 5
  },
  {
    // 827.1.c.3 / 206.1：这条文本改写的正是该 Empower 起动费用，不是独立效果。
    kind: "static",
    effect: {
      kind: "continuous.cost-modification",
      resource: "energy",
      appliesTo: "empower-activation-cost",
      amount: { kind: "constant", value: -3 },
      // 356.6：Energy 费用不能被减到 0 以下；具体钳制由费用计划执行。
      minimum: 0
    },
    condition: {
      kind: "compare",
      left: {
        kind: "count",
        subject: "runes",
        filter: { type: "rune", controller: "self", zone: "rune-zone" }
      },
      operator: "lte",
      right: { kind: "constant", value: 4 }
    }
  },
  {
    // 828.1.b.1 / 828.1.c：宿主拥有 Empowered 状态时获得 [Deflect] 与 [Assault 2]。
    kind: "static",
    effect: {
      kind: "continuous.grant-keyword",
      appliesTo: "self",
      keywords: [
        { id: "deflect", value: 1 },
        { id: "assault", value: 2 }
      ]
    },
    // 828.1.c 的 Empowered 门控用显式谓词占位；本程序不手写状态判定。
    condition: {
      kind: "expression",
      value: { kind: "constant", value: "empowered" }
    }
  }
];

export default {
  canonicalCardId: "card.hash-43ef38def4a837781a4013a179db99f1eb1e312f85de8d9c3053f7168a1652f5",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "四处依赖未合入：(1) 缺 Empower/Empowered 的 KeywordDef（effects/keywords/ 注册表无该条目），" +
    "827.1.c.1 的「5 Energy：Empower me」起动费用、827.1.c.5 的「仅当未 Empowered 时启动」限制都无展开路径" +
    "（programs/keywords.ts 的 expandProgram 在缺 KeywordDef 时直接 judge-required）；" +
    "(2) 827.1.c.3/206.1 的费用改写没有消费方——cost/cost-plan.ts 只在调用方显式传入 discounts 时应用折扣，" +
    "没有模块把卡程序的 continuous.cost-modification 接到 Empower 起动费用上；" +
    "(3) 828.1.c 的 Dependent Ability 门控需要 empowered 谓词——ObjectSnapshot 没有该字段、" +
    "测试内核的 empowered 计数不进入快照，condition.predicate 无法求值（RIFT-359）；" +
    "(4)「I have [Deflect] and [Assault 2]」的 continuous.grant-keyword 原语已合入并由 golden 真实执行，" +
    "但 Empower/Empowered 本体仍缺 KeywordDef，被授予的 Deflect 还缺 809.1.c 的目标税" +
    "（target.tax 未注册，RIFT-360）。" +
    "已支持部分：印刷的「4 or fewer runes」计数条件（133.5.a.1/431.1）与授予原语的 ability 图层注册" +
    "由 golden 真实求值。不近似实现。",
  abilities,
  sourceText:
    "[Empower] :rb_energy_5:. This ability costs :rb_energy_3: less if you control 4 or fewer runes. " +
    "(Pay the cost: Empower me. Use only if not Empowered.)\n" +
    "[Empowered][>] I have [Deflect] and [Assault 2]. (Opponents must pay :rb_rune_rainbow: to choose me " +
    "with a spell or ability. +2 :rb_might: while I'm an attacker.)"
} satisfies CardProgram;

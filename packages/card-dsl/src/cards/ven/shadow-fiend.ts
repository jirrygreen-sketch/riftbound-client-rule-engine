import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Shadow Fiend (ven-014-166) — Unit, Fury, tag Ionia.
 * energy 2, power: none printed, Might 2.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-014-166，逐字）：
 *   [Empower] :rb_energy_2::rb_rune_fury: (:rb_energy_2::rb_rune_fury:: Empower me.
 *   Use only if not Empowered.)
 *   [Empowered][>] I have [Assault 3]. (+3 :rb_might: while I'm an attacker.)
 *
 * 规则依据（Core Rules v1.5）：
 * - 827.1 / 827.1.c / 827.1.c.1：Empower 是启动能力关键词，印刷费用由费用部分的
 *   :rb_energy_2::rb_rune_fury: 给出（2 能量 + 1 个 Fury Power；135.2.e.4 的域符号即
 *   Power，135.2.b.5.b 的能量符号是 Energy）；功能等价于「该费用：Empower this。仅当未
 *   Empowered 时启动」。827.1.b.1 规定来源本身不是该能力的目标。
 * - 827.1.c.3 / 206.1：Empower 费用可以被卡面文本改写；本卡没有改写文本，费用就是印刷值。
 * - 828.1 / 828.1.b.1 / 828.1.c：“[Empowered][>]” 之后的整句是 Dependent Ability，
 *   持有 Empowered 状态时 Active，等价于 “While I have the Empowered status, this card
 *   gains '[Text]'”。
 * - 807.1 / 807.1.b / 807.1.c：[Assault 3] 的功能文本是 “While I am an attacker, I have
 *   +3 [M]”；括号内正是该提醒文本，不构成第二条能力。关键词只声明、不重写（契约 3.7）。
 *
 * 当前状态与剩余接线见 judgeReason；不以原语存在代替整卡执行证据。
 */
const abilities: Ability[] = [
  {
    kind: "keyword",
    keyword: "empower"
  },
  {
    // 828.1.b.1 / 807.1.c：持有 Empowered 时宿主获得 [Assault 3]。
    kind: "static",
    effect: {
      kind: "continuous.grant-keyword",
      appliesTo: "self",
      keywords: [{ id: "assault", value: 3 }]
    },
    // 828.1.c 的门控读取来源当前 Empowered 状态；生产快照缺字段时失败闭合。
    condition: {
      kind: "compare",
      left: { kind: "object-property", object: "self", property: "empowered" },
      operator: "gte",
      right: { kind: "constant", value: 1 }
    }
  }
];

export default {
  canonicalCardId: "card.hash-b0dae42b029e826ed425d0108e52126d253bfbcb0232487d1515afeae22ef257",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口（827.1.c.1、807.1.c），均不近似实现：" +
    "(1) Empower KeywordDef 已注册并支持未 Empowered 限制，但 KeywordAbility / programs/keywords.ts 不传递本卡的 2 Energy + 1 Fury Power CostSpec" +
    "（契约 3.1 的 KeywordAbility 只有 keyword/value），expand 只产出 { kind: \"empower\" }，费用规划实测抛 " +
    "CostPlanError judge-required \"Unsupported cost kind: empower\"，无法建立完整启动费用计划。" +
    "(2) 828.1.c 门控 self.empowered >= 1 在参考内核里已随真实 empower/disempower 动作开关（bindStatic golden 实测 Assault 3 的授予与撤销），" +
    "但生产 ObjectSnapshot 不声明 live empowered 计数（apps/game-server 的引擎宿主把 empower 动作写成 buffs），缺字段时失败闭合。" +
    "(3) 授予后的关键词没有下游消费方：continuous.grant-keyword 与 programs/statics.ts 的 ability 图层绑定已合入，" +
    "但 Assault 展开读取的 designation 没有公开 combatRole 的实时发布方——解释器实测 \"Unavailable characteristic: designation\"，" +
    "授予后的关键词也不会随图层变化重新展开，807.1.c 的攻击者 +3 尚无完整执行路径。",
  abilities,
  sourceText:
    "[Empower] :rb_energy_2::rb_rune_fury: (:rb_energy_2::rb_rune_fury:: Empower me. Use only if not Empowered.)\n" +
    "[Empowered][>] I have [Assault 3]. (+3 :rb_might: while I'm an attacker.)"
} satisfies CardProgram;

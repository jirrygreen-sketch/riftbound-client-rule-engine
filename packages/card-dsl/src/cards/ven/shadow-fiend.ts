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
 *   :rb_energy_2::rb_rune_fury: 给出（1 能量 + 1 个 Fury Power；135.2.e.4 的域符号即
 *   Power，135.2.b.5.b 的能量符号是 Energy）；功能等价于「该费用：Empower this。仅当未
 *   Empowered 时启动」。827.1.b.1 规定来源本身不是该能力的目标。
 * - 827.1.c.3 / 206.1：Empower 费用可以被卡面文本改写；本卡没有改写文本，费用就是印刷值。
 * - 828.1 / 828.1.b.1 / 828.1.c：“[Empowered][>]” 之后的整句是 Dependent Ability，
 *   持有 Empowered 状态时 Active，等价于 “While I have the Empowered status, this card
 *   gains '[Text]'”。
 * - 807.1 / 807.1.b / 807.1.c：[Assault 3] 的功能文本是 “While I am an attacker, I have
 *   +3 [M]”；括号内正是该提醒文本，不构成第二条能力。关键词只声明、不重写（契约 3.7）。
 *
 * status = judge-required（依赖均不近似实现）：
 * 1. effects/keywords/ 没有 Empower/Empowered KeywordDef（当前注册表就是不含它们），
 *    827.1.c.1 的起动费用与 827.1.c.5 的 “Use only if not Empowered” 限制无展开路径；
 *    卡程序按契约 3.1 只能声明 keyword 能力（费用只能记在注释/judgeReason，见回复的
 *    契约变更请求：KeywordAbility 没有承载印刷费用的字段）。
 * 2. 没有任何模块把卡程序声明的 Empower 费用接进 Finalize 的费用计划
 *    （cost.modify 原语已合入，但 programs/play.ts 的卡牌侧接线未合入）。
 * 3. 828.1.c 的状态门控需要 empowered 谓词（condition.predicate）；当前 Condition 没有该谓词。
 * 4. “I have [Assault 3]” 是 continuous.grant-keyword 图层授予（且功能上等于 807.1.c 的
 *    attacker 条件 Might 修正）：programs/statics.ts 的 createEngineStaticBinder().bindStatic
 *    已能把该声明装进 ability 图层并在快照里写出 assault 3（golden 有执行证据）；
 *    依赖能力本身的 Empowered 门控仍无谓词。
 * 依赖：新增 Empower/Empowered KeywordDef、卡牌侧费用接线、Empowered 状态谓词（RIFT-359 进行中）。
 * 本程序不把依赖能力写成无条件能力，不手写 Empowered 判定，也不用 Buff 计数近似 +3 Might。
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
    // 828.1.c 的门控用显式谓词占位；本程序不手写状态判定。
    condition: {
      kind: "expression",
      value: { kind: "constant", value: "empowered" }
    }
  }
];

export default {
  canonicalCardId: "card.hash-b0dae42b029e826ed425d0108e52126d253bfbcb0232487d1515afeae22ef257",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "四处依赖未合入：(1) 缺 Empower/Empowered 的 KeywordDef（当前关键词注册表不含它们），" +
    "827.1.c.1 的「2 Energy + 1 Fury Power：Empower me」起动费用与 827.1.c.5 的「仅当未 Empowered 时启动」限制无展开路径，" +
    "卡程序按契约 3.1 只能声明 keyword 能力（印刷费用见本文件注释与回复的契约变更请求）；" +
    "(2) 没有模块把卡程序声明的 Empower 费用接进 Finalize 的费用计划（cost.modify 原语已合入，" +
    "卡牌侧接线仍缺）；" +
    "(3) 828.1.c 的 Dependent Ability 门控需要 empowered 谓词（condition.predicate），当前 Condition 没有该谓词；" +
    "(4)「I have [Assault 3]」是 continuous.grant-keyword 图层授予（807.1.c 的功能文本是 attacker 条件下 +3 Might），" +
    "programs/statics.ts 的 createEngineStaticBinder().bindStatic 已能把该声明装进 ability 图层并写出 assault 3 " +
    "（golden 有执行证据）；剩余缺口是依赖能力本身的 Empowered 门控谓词（RIFT-359 进行中）。" +
    "依赖：新增 Empower/Empowered KeywordDef、卡牌侧费用接线、Empowered 状态谓词。不近似实现（不用 Buff 计数代替 Might 修正，" +
    "不把依赖能力写成无条件能力）。",
  abilities,
  sourceText:
    "[Empower] :rb_energy_2::rb_rune_fury: (:rb_energy_2::rb_rune_fury:: Empower me. Use only if not Empowered.)\n" +
    "[Empowered][>] I have [Assault 3]. (+3 :rb_might: while I'm an attacker.)"
} satisfies CardProgram;

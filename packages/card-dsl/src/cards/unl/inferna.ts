import type { CardProgram } from "../../ir/index.js";

/**
 * Inferna (unl-002-219) — Unit, 2 Energy, Might 1, Fury, tag Bilgewater.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-002-219，逐字）：
 *   "[Ambush] (You may play me as a [Reaction] to a battlefield where you have units.)\n"
 *   "[Assault 2] (+2 :rb_might: while I'm an attacker.)"
 *
 * 规则依据（CR v1.5）：
 * - [Ambush]（822）：822.1 是被动能力关键词；822.1.b 功能上等价于 "I may be played
 *   to a battlefield where you control Units" 与 "I have Reaction while being played
 *   this way"；822.1.c 是给单位的可打出位置增加选项的被动能力（不移除原有选项）；
 *   822.2 说明多个实例冗余；822.4 说明是否具有 Ambush 是可引用的特征。
 *   卡牌按契约 3.7 只声明 keyword；合法位置改写与 Reaction 许可归关键词展开与
 *   chain/canAct（关键词展开已合入，地点权限的消费仍缺）。
 * - [Assault 2]（807.1.b.1-2 / 807.1.c）：Assault Value = 印刷值 2；功能上等价于
 *   "While I am an attacker, I have +2 [M]"；807.1.d / 807.1.d.1 说明该修正在取得
 *   Attacker designation 期间生效；807.2 多来源相加、合并为一个 Assault Value；
 *   807.3 说明这是可被引用的特征。展开（static continuous.might + designation
 *   条件）由 effects/keywords/Assault.ts 提供，卡文件不重复实现。
 *
 * status = judge-required（按 2026-10-17 HEAD 复核；缺口不近似实现）：
 * - [Ambush]（822.1.b）：KeywordDef 展开的两个 static 都仍不能进入生产图层。实测
 *   createEngineStaticBinder().bindStatic 对 play-location-permission 抛 ProgramBindingError
 *   "Static ability kind play-location-permission has no layer mapping"（programs/statics.ts
 *   的 layerFor 不认识该 kind），对 continuous.timing 抛 "Unsupported static appliesTo [\"card\"]"
 *   （appliesTo 的 self/source 之外没有卡片许可形状）。Finalize 的地点选择面也没有消费
 *   “有你控制单位的战场”符号权限（chain/engine.ts 的 playDestinationIsLegal 只查 continuous.location
 *   的 permission/restriction 名称）。不能把它改写成全局 [Reaction]（822.1.b 的 Reaction 只在用
 *   Ambush 打出那一次成立，813.1.c 的 [Reaction] 是整张牌的常驻许可）。
 * - [Assault 2]（807.1.c / 807.1.d.1）：KeywordDef 展开与 CardProgram static 绑定都已合入，
 *   continuous.might 能注册；但展开条件送入 evaluateCondition（其 compare 分支只走
 *   evaluateExpression，不经过 interpreter/expr-ext 的 designation→combatRole 映射，也不读图层快照），
 *   ObjectSnapshot 的字段是 combatRole 而非 designation，求值抛 MissingInformation 后被
 *   programs/statics.ts 捕获为 false。实测：combatRole = "attacker" 的单位经生产绑定后
 *   Effective Might 仍是印刷值（1），即攻击者拿不到 +2。
 * 依赖：play-location-permission 的图层/Finalize 消费方、continuous.timing 的卡片许可形状，
 * 以及静态条件求值入口对 designation→combatRole 的映射。
 */
export default {
  canonicalCardId:
    "card.hash-90eefb9ab8b0769620abebf96a6feb3bfd91535bf652b0311542f4d61d68a2e7",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "仍缺：(1) Ambush（CR 822.1.b/822.3）的两个 static 都不能绑定：programs/statics.ts 的 layerFor 对 " +
    "play-location-permission 抛 ProgramBindingError（no layer mapping），continuous.timing 的 appliesTo [\"card\"] " +
    "也被 staticTarget 以 unsupported appliesTo 拒绝；chain/engine.ts 的 playDestinationIsLegal 只消费 continuous.location " +
    "的 permission 名称，没有消费「有你控制单位的战场」这一符号权限。" +
    "(2) Assault 2（807.1.c/807.1.d.1）的展开条件读取 designation，而 ObjectSnapshot 提供的是 combatRole：" +
    "evaluateCondition 的 compare 分支只走 evaluateExpression（不经 interpreter/expr-ext 的 designation→combatRole 映射），" +
    "求值抛 MissingInformation 后被 programs/statics.ts 捕获为 false；实测 combatRole=attacker 的单位仍保持印刷 Might（1），" +
    "攻击时的 +2 未生效。依赖：play-location-permission/continuous.timing 的图层与 Finalize 消费方，" +
    "以及静态条件求值入口的 designation → combatRole 映射。",
  abilities: [
    { kind: "keyword", keyword: "ambush" },
    // 807.1.b.1-2 / 807.1.b.3：印刷为 "Assault 2"，Assault Value = 2（缺省才是 1）。
    { kind: "keyword", keyword: "assault", value: 2 }
  ],
  sourceText:
    "[Ambush] (You may play me as a [Reaction] to a battlefield where you have units.)\n" +
    "[Assault 2] (+2 :rb_might: while I'm an attacker.)"
} satisfies CardProgram;

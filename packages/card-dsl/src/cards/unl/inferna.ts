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
 *   chain/canAct（effects/keywords/Ambush.ts 尚未合入）。
 * - [Assault 2]（807.1.b.1-2 / 807.1.c）：Assault Value = 印刷值 2；功能上等价于
 *   "While I am an attacker, I have +2 [M]"；807.1.d / 807.1.d.1 说明该修正在取得
 *   Attacker designation 期间生效；807.2 多来源相加、合并为一个 Assault Value；
 *   807.3 说明这是可被引用的特征。展开（static continuous.might + designation
 *   条件）由 effects/keywords/Assault.ts（RIFT-81）提供，卡文件不重复实现。
 *
 * status = judge-required（缺口不近似实现）：
 * - [Ambush] 没有 KeywordDef 文件（effects/keywords/ 下无 Ambush.ts），822.1.b/.c 的
 *   合法打出位置与 Reaction 许可因此没有展开实现；也不能用 [Reaction] 关键词冒充
 *   （822.1.b 的 Reaction 只在"以 Ambush 方式打出"时成立，且只落在该次打出的链项上）。
 * - [Assault 2] 的展开文件已合入，但没有生产方把卡牌的 keyword 能力解析成 KeywordDef
 *   展开并注册进图层（layers/engine.ts 的 registerContinuousEffect 无调用方），
 *   且 807.1.d 的 Attacker designation 不是 ObjectSnapshot 特征（契约 3.8 的 combatRole
 *   未进当前 HEAD）。
 *
 * 依赖：RIFT-84（kw-* 关键词展开批次中的 Ambush）、RIFT-81 / RIFT-91（Assault 展开与
 * 图层接线）、契约 3.8 的 combatRole 落地。
 */
export default {
  canonicalCardId:
    "card.hash-90eefb9ab8b0769620abebf96a6feb3bfd91535bf652b0311542f4d61d68a2e7",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处依赖未合入：(1) [Ambush]（822）没有已合入的 KeywordDef——effects/keywords/ 下无 Ambush.ts，" +
    "822.1.b/.c 的“可打到你有单位的战场”位置改写与仅在该次打出时成立的 Reaction 许可没有展开实现；" +
    "不能用 [Reaction] 关键词冒充（813.1.c 的 Reaction 是整张牌的常驻许可，而 822.1.b 的" +
    "Reaction 只在以 Ambush 方式打出的那一次成立）。" +
    "(2) [Assault 2] 的展开文件 effects/keywords/Assault.ts（RIFT-81：static continuous.might + " +
    "compare(object-property(self, 'designation'), eq, 'attacker')）已合入，但没有生产方把卡牌的 keyword " +
    "能力解析为 KeywordDef 展开并注册成 continuous 效果（registerContinuousEffect 无调用方），" +
    "且 807.1.d 的 Attacker designation 不是 ObjectSnapshot 特征（契约 3.8 combatRole 未进 HEAD）。" +
    "依赖：RIFT-84（kw-* 展开批次中的 Ambush）、RIFT-81 / RIFT-91（Assault 展开与图层接线）、" +
    "契约 3.8 的 combatRole 落地。不近似实现。",
  abilities: [
    { kind: "keyword", keyword: "ambush" },
    // 807.1.b.1-2 / 807.1.b.3：印刷为 "Assault 2"，Assault Value = 2（缺省才是 1）。
    { kind: "keyword", keyword: "assault", value: 2 }
  ],
  sourceText:
    "[Ambush] (You may play me as a [Reaction] to a battlefield where you have units.)\n" +
    "[Assault 2] (+2 :rb_might: while I'm an attacker.)"
} satisfies CardProgram;

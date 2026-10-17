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
 * status = judge-required（按 2026-10-16 合入批次复核；缺口不近似实现）：
 * - [Ambush] 的 KeywordDef 已合入（effects/keywords/Ambush.ts，RIFT-266），展开为
 *   play-location-permission 与 continuous.timing 两个静态声明；两个声明都没有消费方：
 *   programs/statics.ts 缺省 noopStaticBinder，layers/rules/query.ts 的 playLocations()
 *   没有调用方，chain.canAct() 也不读取图层时机许可。仍然不能用 [Reaction] 关键词冒充
 *   （822.1.b 的 Reaction 只在以 Ambush 打出那一次成立，813.1.c 的 [Reaction] 是整张牌的常驻许可）。
 * - [Assault 2] 的 KeywordDef 已合入（RIFT-102 批次），programs/keywords.ts 的 expandProgram
 *   会把 keyword 声明解析成展开并做校验；但展开出的静态效果仍需卡牌 static 生产方注册进图层，
 *   且 Assault.ts 的条件读宿主 "designation"（807.1.d），而 ObjectSnapshot 只有 combatRole
 *   （契约 3.8），layers/engine.ts 的 conditionMatches 不评估 compare、未识别按 true
 *   （exp25 实测：非攻击者也 +2），因此直接注册会把「仅攻击者 +2」变成常驻 +2。
 * 依赖：卡牌 static/keyword 展开 → layers 的注册路径（RIFT-257 后续）、playLocations/canAct
 * 消费方（RIFT-259 后续）、图层 compare 条件与 designation/combatRole 对齐（RIFT-91 后续）。
 */
export default {
  canonicalCardId:
    "card.hash-90eefb9ab8b0769620abebf96a6feb3bfd91535bf652b0311542f4d61d68a2e7",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处缺口，均不近似实现（已按 2026-10-16 合入批次复核）：" +
    "(1) [Ambush]（822）的 KeywordDef 已合入（effects/keywords/Ambush.ts，RIFT-266），展开为 " +
    "play-location-permission 与 continuous.timing 两个静态声明，但都没有消费方：programs/statics.ts 缺省 " +
    "noopStaticBinder（没有把卡牌 static 能力注册进图层的入口），layers/rules/query.ts 的 playLocations() " +
    "无调用方，chain.canAct() 不读取图层时机许可；仍不能用 [Reaction] 关键词冒充（822.1.b 的 Reaction " +
    "只在以 Ambush 打出那一次成立，813.1.c 的 [Reaction] 是整张牌的常驻许可）。" +
    "(2) [Assault 2]（807.1.b.3 的印刷值 2）的 KeywordDef 已合入（RIFT-102 批次）且 programs/keywords.ts " +
    "会解析 keyword 声明并校验展开；但展开出的 static continuous.might 仍缺卡牌 static 生产方，且 Assault 的 " +
    "条件 compare(object-property(self, 'designation'), eq, 'attacker')（807.1.d）无法诚实求值：" +
    "ObjectSnapshot 只有 combatRole（契约 3.8），layers/engine.ts 的 conditionMatches 不评估 compare、" +
    "未识别时按 true（实测非攻击者也 +2），直接注册会把「仅攻击者 +2」变成常驻 +2。" +
    "依赖：卡牌 static/keyword 展开 → layers 注册（RIFT-257 后续）、playLocations/canAct 消费方（RIFT-259 后续）、" +
    "图层 compare 条件与 designation/combatRole 对齐（RIFT-91 后续）。",
  abilities: [
    { kind: "keyword", keyword: "ambush" },
    // 807.1.b.1-2 / 807.1.b.3：印刷为 "Assault 2"，Assault Value = 2（缺省才是 1）。
    { kind: "keyword", keyword: "assault", value: 2 }
  ],
  sourceText:
    "[Ambush] (You may play me as a [Reaction] to a battlefield where you have units.)\n" +
    "[Assault 2] (+2 :rb_might: while I'm an attacker.)"
} satisfies CardProgram;

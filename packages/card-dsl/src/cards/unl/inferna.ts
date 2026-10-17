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
 * status = judge-required（按当前 HEAD 复核；缺口不近似实现）：
 * - [Ambush] 的 KeywordDef 已展开为 play-location-permission 与 continuous.timing 两个静态声明，
 *   但 programs/statics.ts 没有把 play-location-permission 映射到图层，且 Finalize 的地点选择面
 *   不能消费其“有你控制单位的战场”符号权限。不能把它改写成全局 [Reaction]（822.1.b 的
 *   Reaction 只在用 Ambush 打出那一次成立，813.1.c 的 [Reaction] 是整张牌的常驻许可）。
 * - [Assault 2] 的 KeywordDef 会由 programs/keywords.ts 展开，CardProgram static 也已接入图层；
 *   但 Assault 条件读取宿主的 "designation"（807.1.d），ObjectSnapshot 只有 combatRole，
 *   Expr 求值无法取得攻击者身份并会失败关闭，所以不能诚实地只在攻击时提供 +2。
 * 依赖：Ambush 的地点权限/Finalize 消费方，以及 designation 与 combatRole 的条件谓词接线。
 */
export default {
  canonicalCardId:
    "card.hash-90eefb9ab8b0769620abebf96a6feb3bfd91535bf652b0311542f4d61d68a2e7",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处缺口，均不近似实现：(1) [Ambush]（822.1.b）的 KeywordDef 已展开为 play-location-permission 与 " +
    "continuous.timing 静态声明，但 programs/statics.ts 没有 play-location-permission 的图层映射，" +
    "Finalize 地点选择面也不能消费“有你控制单位的战场”这一符号权限；不能用全局 [Reaction] 冒充。" +
    "(2) [Assault 2]（807.1.b.3）的 KeywordDef 会展开为 static continuous.might，CardProgram static 已接入图层，" +
    "但条件读取宿主的 designation（807.1.d），ObjectSnapshot 只有 combatRole，Expr 求值无法取得攻击者身份并失败关闭，" +
    "因此不能把 +2 误作常驻修正。依赖：Ambush 地点权限的 Finalize 消费方，以及 designation/combatRole 的条件谓词接线。",
  abilities: [
    { kind: "keyword", keyword: "ambush" },
    // 807.1.b.1-2 / 807.1.b.3：印刷为 "Assault 2"，Assault Value = 2（缺省才是 1）。
    { kind: "keyword", keyword: "assault", value: 2 }
  ],
  sourceText:
    "[Ambush] (You may play me as a [Reaction] to a battlefield where you have units.)\n" +
    "[Assault 2] (+2 :rb_might: while I'm an attacker.)"
} satisfies CardProgram;

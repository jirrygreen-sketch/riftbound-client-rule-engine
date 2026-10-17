import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * rad-063-167 Kai'Sa, Rebel（能量 5、Power 1、Might 5、领域 Mind、
 * 标签 Kai'Sa/The Void/Champion）。
 *
 * 原文（逐字，来自本地 deck-catalog）：
 *   [Disarm] (When I attack, give an enemy unit here -1 :rb_might: this turn).
 *   While I'm in a showdown, your spells have [Reaction]. (Play them any time,
 *   even before spells and abilities resolve.)
 *
 * ⚠ 数据问题（不改数据，随任务回复上报）：同 canonicalCardId 的另一印刷
 *   rad-sp4-005 原文只有 "[Disarm]\nWhile I'm in a showdown, your spells have
 *   [Reaction]."（无提醒文本），且 ability-templates.json 对本身份记录 blockers
 *   ["non-reminder-printing-difference", "printing-stat-type-or-tag-difference"]、
 *   currentCoverageStatuses ["judge-required"]。两印刷的 Might 也不同（167 印 5、
 *   sp4 印 4，属同一 canonical 的印刷差异）。本程序按任务卡给定的 rad-063-167
 *   原文逐字编写，不据此推测"真实"数值。
 *
 * 规则依据（CR v1.5）：
 * - [Disarm]（831.1）：Triggered Ability 关键词，831.1.b 是 Attack Trigger，
 *   831.1.d 等价于 "When I attack, give an enemy unit here -X [M] this turn"；
 *   831.1.c.3 省略 X 时按 1；831.1.d.1 同一单位多个 Disarm **合并成一次触发**并按
 *   总数值处理；831.2 不同来源授予的 Disarm 数值相加；831.3 是可引用特征。
 *   按 README 第 5 节只声明关键词与数值，展开（攻击触发 + 临时 Might 修改）属
 *   effects/keywords/<disarm>.ts。
 * - "While I'm in a showdown, your spells have [Reaction]"：这是持续性的**授予**
 *   （Conditional Passive Ability，364.3 的 "while" 形式；813.4 明确"某些被动能力
 *   在条件成立时才授予 Reaction，在此之前该牌不具有该关键词"）。它给"你（能力控制者）
 *   的法术"授予 Reaction（813.1 的许可：Closed State 可打出），条件是我在 showdown。
 *   这不是本卡自身带 [Reaction]（本卡是单位，不是法术），因此不能写成
 *   { kind: "keyword", keyword: "reaction" }。
 *
 * 状态：judge-required。缺口：
 * 1. 关键词注册表没有 Disarm 定义（实测 keywordDefinitionsById 无 "disarm"）：展开需要
 *    一次 attack-declared 触发（时点已存在于 events/timing-points.ts）加"给此处一个敌方
 *    单位 -1 Might 本回合"的临时 Might 修改；契约 3.6 的封闭 GameAction 集合没有 might
 *    修改动作，effect.buff 文档明确临时 Might 属 layers 的 continuous.might（未有实现），
 *    且 831.1.d.1 要求把同一单位多个实例合并成一次触发（stacking sum）。
 * 2. 条件式授予"你的法术具有 [Reaction]"需要 continuous.grant-keyword（带条件与
 *    "while I'm in a showdown"的时窗）；该持续效果原语未注册，图层消费方（RIFT-91）
 *    与"是否在 showdown"的可读状态也尚未提供（ObjectSnapshot 无 combat/showdown 字段）。
 * 依赖：Disarm KeywordDef（无已分配任务号）、RIFT-91（layers-continuous）、
 * 契约 3.8（combatRole 等战斗身份特征）。
 * 不近似实现：不把 Disarm 近似成 effect.buff，也不把"授予你的法术 Reaction"写成
 * 本卡自身的 keyword reaction。
 */
const abilities: Ability[] = [
  {
    // 831.1.c.3：印刷式 "[Disarm]" 省略数值，按 1 处理；声明时把最简值显式写出。
    kind: "keyword",
    keyword: "disarm",
    value: 1
  },
  {
    // 364.3 + 813.4 的条件式授予："While I'm in a showdown, your spells have
    // [Reaction]." 授予对象是控制者的法术，不是本卡；条件是我在 showdown。
    // op 未注册（见 judgeReason），形状按 3.7 "关键词授予归 continuous.*" 写出，
    // 供后续关键词/图层批次消费。
    kind: "static",
    effect: {
      kind: "continuous.grant-keyword",
      keyword: "reaction",
      filter: { type: "spell", controller: "controller" },
      appliesTo: "controller-spells"
    },
    condition: {
      kind: "expression",
      value: { kind: "object-property", object: "self", property: "in-showdown" }
    }
  }
];

const program = {
  canonicalCardId:
    "card.hash-9dec9472d1f77a1c3d9249566ca3fa89140e7b6a4efcb6fe375c4fab210d2e87",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "Disarm KeywordDef（RIFT-267）与 continuous.might、continuous.grant-keyword（RIFT-258）已合入，" +
    "但整卡仍有两处缺口，均不近似实现：(1) Disarm 的 attack-declared 触发、来源位置绑定与 831.1.d.1 的 stacking sum 尚未接入生产触发注册；" +
    "(2) 条件式授予「While I'm in a showdown, your spells have [Reaction]」（364.3 / 813.4）需要卡牌 static → layers 注册路径与 showdown 可读状态，" +
    "ObjectSnapshot 目前没有 in-showdown 字段。依赖：RIFT-91、RIFT-120。不把 Disarm 写成 effect.buff，" +
    "也不把「授予你的法术 Reaction」写成本卡自身的 keyword reaction。另见数据问题：同身份的 rad-sp4-005 印刷文本与 Might 不同。",
  abilities,
  sourceText:
    "[Disarm] (When I attack, give an enemy unit here -1 :rb_might: this turn).\n" +
    "While I'm in a showdown, your spells have [Reaction]. (Play them any time, even before spells and abilities resolve.)"
} satisfies CardProgram;

export default program;

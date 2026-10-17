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
 * 状态：judge-required。Disarm KeywordDef、continuous.might 与 continuous.grant-keyword
 * 均已合入，生产 static → layers 注册也已可用；缺口收敛为两点（均由测试实证）：
 * 1. Disarm 展开出的目标过滤器使用 sameLocationAs:"source"，生产触发注册
 *    （programs/filters.ts）的白名单拒绝该字段并抛 judge-required；同时 attack-declared
 *    时点仍没有生产发射方（战斗结算在 combat-start-transaction 处被阻断），因此触发
 *    既无法注册也无法被发出（CR v1.5 831.1.d / 831.1.d.1）。
 * 2. "While I'm in a showdown" 缺少可读状态：ObjectSnapshot 没有 in-showdown 字段，
 *    特征表达式会抛 MissingInformation，生产绑定按 fail-closed 处理（条件恒 false）。
 * static → layers 路径会直接把条件成立的 chain 法术标记为 Reaction；当前只剩上面两项
 * 生产接线/状态特征缺口，因此保持 judge-required。
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
    // 授予对象按 813.4.a 是 chain 上的法术，所以过滤器显式带 zone:"chain"，
    // 不再依赖旧的 appliesTo:"controller-spells" 写法（生产绑定的 staticTarget
    // 只接受 self 或省略 appliesTo）。
    kind: "static",
    effect: {
      kind: "continuous.grant-keyword",
      keyword: "reaction",
      filter: { type: "spell", controller: "controller", zone: "chain" }
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
    "Disarm KeywordDef（RIFT-267）、continuous.might 与 continuous.grant-keyword（RIFT-258）已合入，" +
    "生产触发注册与 static → layers 绑定也已接通，但整卡仍有两处缺口，均不近似实现：" +
    "(1) Disarm 展开的触发目标过滤器使用 sameLocationAs，被生产触发注册的过滤器白名单拒绝，" +
    "且 attack-declared 时点仍没有生产发射方（战斗结算在 combat-start-transaction 处被阻断），" +
    "对应 CR v1.5 831.1.d / 831.1.d.1；" +
    "(2) 条件「While I'm in a showdown」（364.3 / 813.4）缺少可读状态，ObjectSnapshot 没有 in-showdown 字段，" +
    "静态绑定的特征表达式会抛 MissingInformation 并按 fail-closed 处理（条件恒 false）；" +
    "不把 Disarm 写成 effect.buff，" +
    "也不把「授予你的法术 Reaction」写成本卡自身的 keyword reaction。另见数据问题：同身份的 rad-sp4-005 印刷文本与 Might 不同。",
  abilities,
  sourceText:
    "[Disarm] (When I attack, give an enemy unit here -1 :rb_might: this turn).\n" +
    "While I'm in a showdown, your spells have [Reaction]. (Play them any time, even before spells and abilities resolve.)"
} satisfies CardProgram;

export default program;

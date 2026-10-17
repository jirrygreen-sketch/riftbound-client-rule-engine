import type { CardProgram } from "../../ir/index.js";

/**
 * Siren of the Shallows（rad-097-167）— 印刷 cardType "Spell"，2 能量，力量 null，
 * Might 1，领域 Chaos。
 *
 * 原文（packages/card-data/data/deck-catalog.json rad-097-167，逐字）：
 *   "[Disarm] (When I attack, give an enemy unit here -1 :rb_might: this turn.)
 *    [Ganking] (I can move from battlefield to battlefield.)"
 *
 * 规则依据（CR v1.5）：
 * - 831 / 831.1.b / 831.1.d：Disarm 是 Triggered Ability 关键词，只出现在单位上，功能上等于
 *   "When I attack, give an enemy unit here -X [M] this turn."；831.1.c.3：印刷为 "[Disarm]"
 *   未写 X 时 X 视为 1（因此本程序按 README §5 省略 value，默认值由关键词展开负责）；
 *   831.1.d.1 / 831.2：同一单位的多个 Disarm 只触发一次、数值相加。
 * - 810 / 810.1.b：Ganking 是被动能力关键词，功能上等于「我可用标准移动在战场之间移动」。
 * - reminder 括号内的文字是关键词的规则释义，不是独立指令，不另写指令。
 *
 * status = judge-required（不近似实现），按 RIFT-258/259/267 合入后的状态复核：
 * 1. Disarm 的 KeywordDef 已合入（effects/keywords/Disarm.ts，RIFT-267）：展开为
 *    attack-declared 触发 + continuous.might(-X, this-turn)，其 Might 体可用真实解释器
 *    与图层引擎执行（golden 执行展开体并检查注册与分层结果）。整卡仍不可执行的部分是
 *    触发侧：attack-declared 时点尚未被任何生产者发出（combat/flow.ts 明确以
 *    combat-start-transaction 阻断角色事务，时点产生方审计标为「待后续」），且
 *    CardProgram → keyword → TriggerRegistration 的接线属 RIFT-257，尚未合入；
 *    展开体的目标过滤器还用 sameLocationAs: "source" 锚点，引擎 trigger-spec 的
 *    ObjectFilter 词表没有该锚点。
 * 2. Ganking 的 KeywordDef 已注册（RIFT-83），但其展开写的是 effect.permission:
 *    "battlefield-to-battlefield"（字符串），而图层读取方（layers/rules/query.ts 的
 *    movement()）只从 effect.permission.routes 数组提取路由；已合入的
 *    continuous.movement 指令（RIFT-259）注册的正是 routes 形状，两者形状不匹配，
 *    把关键词展开原样注册后 MovementPermissions.canGank 仍为 false。此外卡牌程序 →
 *    关键词注册 → 移动许可消费的接线属 RIFT-257。
 *
 * 数据问题（不改数据）：该印刷在 deck-catalog 中 cardType = "Spell" 却带 might = 1，
 * 与 CR 143.2（Might 是单位的固有属性）及 Disarm/Ganking 只出现在单位上（831.1.a、810.1.a）
 * 不一致，疑似本地卡片数据的类型标记问题；详见任务回复。
 */
const sirenOfTheShallows = {
  canonicalCardId: "card.hash-62965a5787d4b9aff0b49316615355a97d59939503fd28b217e578ee755f0d63",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处缺口，均不近似实现：(1) [Disarm] 的 KeywordDef 已合入（RIFT-267），展开体的 " +
    "continuous.might(-1, this-turn) 可用真实解释器与图层引擎执行（golden 已执行），" +
    "但 attack-declared 时点尚无生产者——combat/flow.ts 的角色事务仍以 combat-start-transaction 阻断" +
    "（时点产生方审计标为「待后续」），且 CardProgram → keyword → TriggerRegistration 接线属 RIFT-257；" +
    "展开体的 sameLocationAs 锚点也不在引擎 trigger-spec 的 ObjectFilter 词表内。" +
    "(2) [Ganking] 的 KeywordDef（RIFT-83）展开写 effect.permission 字符串，而图层读取方 " +
    "layers/rules/query.ts 的 movement() 只读 effect.permission.routes 数组；已合入的 continuous.movement " +
    "指令（RIFT-259）注册的是 routes 形状，原样注册关键词展开得到的 canGank 仍是 false。" +
    "依赖：RIFT-257（触发/关键词绑定）、战斗角色事务（attack-declared 产生方）。",
  abilities: [
    // 831.1.c.3：印刷 [Disarm] 未写 X，默认值 1 由关键词展开负责，卡内省略 value。
    { kind: "keyword", keyword: "disarm" },
    { kind: "keyword", keyword: "ganking" }
  ],
  sourceText:
    "[Disarm] (When I attack, give an enemy unit here -1 :rb_might: this turn.)\n" +
    "[Ganking] (I can move from battlefield to battlefield.)"
} satisfies CardProgram;

export default sirenOfTheShallows;

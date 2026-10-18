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
 * status = judge-required（2026-10-17 复核，两处缺口均实测）：
 * 1. Disarm 的 KeywordDef 已合入（effects/keywords/Disarm.ts）：展开为
 *    attack-declared 触发 + continuous.might(-X, this-turn)，其 Might 体可用真实解释器
 *    与图层引擎执行（golden 执行展开体并检查注册与分层结果）。整卡仍不可执行的部分是
 *    触发侧：attack-declared 时点尚无生产者——combat/flow.ts 的角色事务仍以
 *    combat-start-transaction 阻断（dealDamage 亦为 simultaneous-damage-transaction），
 *    时点产生方审计标为「待后续」；
 *    CardProgram → keyword → TriggerRegistration 的绑定路径已合入（src/programs/triggers.ts），
 *    但展开体的目标过滤器用 sameLocationAs: "source" 锚点，实测触发翻译时抛
 *    ProgramBindingError「Unsupported filter field sameLocationAs」，注册 fail-closed。
 * 2. Ganking 的 KeywordDef 已注册，但其展开写的是 effect.permission:
 *    "battlefield-to-battlefield"（字符串），而图层读取方（layers/rules/query.ts 的
 *    movement()）只从 effect.permission.routes 数组提取路由；实测把关键词展开原样注册后
 *    MovementPermissions.canGank 仍为 false，而 continuous.movement 的 routes 形状注册后为 true。
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
    "两处缺口，均不近似实现：(1) [Disarm] 的 KeywordDef 已合入，展开体的 " +
    "continuous.might(-1, this-turn) 可用真实解释器与图层引擎执行（golden 已执行），" +
    "但 attack-declared 时点尚无生产者——combat/flow.ts 的角色事务仍以 combat-start-transaction 阻断，" +
    "且没有公开的 attack-declared 产生方（dealDamage 仍为 simultaneous-damage-transaction）；" +
    "CardProgram → keyword → TriggerRegistration 的绑定路径已合入（src/programs/triggers.ts），" +
    "但该触发翻译时实测 fail-closed——展开体的 sameLocationAs 锚点不在 trigger-spec/programs 的 " +
    "ObjectFilter 词表内（Unsupported filter field sameLocationAs）。" +
    "(2) [Ganking] 的 KeywordDef 展开写 effect.permission 字符串，而图层读取方 " +
    "layers/rules/query.ts 的 movement() 只读 effect.permission.routes 数组；实测原样注册关键词展开得到的 " +
    "canGank 仍是 false，而已合入的 continuous.movement routes 形状注册后为 true。" +
    "依赖：战斗角色事务（attack-declared 产生方）、sameLocationAs 触发过滤键、Ganking 展开的 routes 形状对齐。",
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

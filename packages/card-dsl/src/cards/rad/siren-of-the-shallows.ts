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
 * status = judge-required（不近似实现）：
 * 1. Disarm 没有 KeywordDef：effects/keywords/ 的已注册关键词（Accelerate、Action、Assault、
 *    Deathknell、Deflect、Equip、Ganking、Hidden、Legion、Mighty、Quick-Draw、Reaction、
 *    Repeat、Shield、Vision、Weaponmaster）不含 Disarm。展开需要攻击触发时点 + 临时 Might
 *    修改（continuous.might）+ 本回合到期（continuous.duration），调研表把 kw-disarm 归到
 *    trigger.combat / continuous.might / continuous.duration（依赖 RIFT-83/84 与 RIFT-91）。
 * 2. Ganking 的 KeywordDef 已注册（RIFT-83），但其展开的 continuous.movement 静态效果还没有
 *    端到端执行路径：卡牌程序 → 关键词注册 → 图层/移动许可消费的接线属于契约 3.5 的
 *    时点/链工作（RIFT-120 后续），当前无执行证据。
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
    "两处依赖未合入，均不近似实现：(1) Disarm 没有 KeywordDef（effects/keywords 注册表 16 个关键词不含 Disarm），" +
    "其展开按 CR 831.1.d 需要攻击触发时点 + 临时 Might 修改（continuous.might）+ 本回合到期" +
    "（continuous.duration），这些消费方尚未合入（依赖 RIFT-83/84 与 RIFT-91；831.1.c.3 的默认 X=1 未写进 value）" +
    "。(2) Ganking 的 KeywordDef 已注册，但卡牌程序→关键词注册→图层/移动许可的接线（契约 3.5）尚无执行路径，" +
    "continuous.movement 静态效果没有端到端证据。",
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

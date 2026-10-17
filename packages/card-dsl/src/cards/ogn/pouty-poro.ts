import type { CardProgram } from "../../ir/index.js";

/**
 * Pouty Poro (ogn-013-298) — Unit, 2 Energy, 2 Might, Fury, Poro.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ogn-013-298）：
 *   [Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or
 *   ability.)
 *
 * 规则依据（CR v1.5）：
 * - 809.1 / 809.1.a：Deflect 是被动能力关键词，通常出现在永久物上；
 * - 809.1.b.3：省略数值时 X 视为 1，因此 keyword 能力不带 value（由关键词文件按
 *   默认值 1 展开）；
 * - 809.1.c/809.1.c.1：功能上等价于「对手的咒语/能力每次选择我时，其打出费用增加
 *   等量、可用任意域力量支付的力量费用」（强制追加费用）；
 * - 809.2：多个来源授予的 Deflect 数值相加（stacking: sum，由关键词文件声明）；
 * - 809.3：是否拥有 Deflect 是可被引用的特征，由 keyword 能力条目承载。
 *
 * 卡牌只声明关键词（契约 3.1/3.7、README 第 5 节）；展开（static target.tax）
 * 由 effects/keywords/Deflect.ts 负责。
 *
 * status = judge-required（复核 2026-10-17）：cost.pay / cost.modify 已合入，旧依赖任务
 * 已过时；当前真实缺口是「Deflect → 目标税 → 任意域 Power 支付」的生产接线：
 * - TargetPlan 只在调用方显式传入 options.tax 时才追加 Deflect 税
 *   （target/target-plan.ts 的 taxSpecs/appendTaxes），没有已合入消费方从被选永久物的
 *   静态 target.tax 派生该税；
 * - 已合入的 static 绑定（programs/statics.ts 的 layerFor）没有 target.tax 的 layer
 *   映射，绑定时抛 ProgramBindingError「Static ability kind target.tax has no layer
 *   mapping」，展开结果接不进图层；
 * - chain/engine.ts 的 Finalize 把收到的税记为 Energy mandatoryAdditional，而
 *   809.1.c/809.1.c.1 要求追加费用用任意域 Power 支付。
 * 依赖：目标税生产接线与任意域 Power 收费（RIFT-360，进行中）。
 */
const poutyPoro = {
  canonicalCardId:
    "card.hash-67d8869cd0857c707456cbffeef13e8907581ac91c85c5b70d64ee7c128db452",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "Deflect 的展开文件（effects/keywords/Deflect.ts：static target.tax）已合入，" +
    "cost.pay / cost.modify 也已合入（旧依赖任务已过时）；当前真实缺口是" +
    "「Deflect → 目标税 → 任意域 Power 支付」生产接线：" +
    "(1) target/target-plan.ts 的 taxSpecs/appendTaxes 只在调用方显式传入 options.tax 时才追加税，" +
    "没有已合入消费方从被选永久物的静态 target.tax 派生该税；" +
    "(2) 已合入的 static 绑定（programs/statics.ts 的 layerFor）没有 target.tax 的 layer 映射，" +
    "绑定时抛 \"Static ability kind target.tax has no layer mapping\"，" +
    "展开结果接不进图层；(3) chain/engine.ts 的 Finalize 把目标税记为 Energy mandatoryAdditional，" +
    "而 809.1.c/809.1.c.1 要求追加费用用任意域 Power 支付。" +
    "依赖：RIFT-360 的目标税生产接线与任意域 Power 收费（进行中）；不近似实现" +
    "（不把 Deflect 写成静态数值、不跳过目标税）。",
  abilities: [{ kind: "keyword", keyword: "deflect" }],
  sourceText:
    "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)"
} satisfies CardProgram;

export default poutyPoro;

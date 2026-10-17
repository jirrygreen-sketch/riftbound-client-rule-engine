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
 * status = judge-required：TargetPlan 只在调用方显式传入 tax 时才追加 Deflect
 * 追加费（target/target-plan.ts 的 taxSpecs/appendTaxes），没有任何已合入消费方从
 * 永久物的 target.tax 持续效果派生该税；chain/engine.ts 的 Finalize 已能接收
 * taxAdapter 回调，但把回调接进实际付费仍依赖未合入的 cost.pay/cost.modify
 * （RIFT-261），且已合入的 tax→费用换算按 Energy 记账（chain/engine.ts:307），与
 * 809.1.c.1 要求的「任意域 Power」不符。
 */
const poutyPoro = {
  canonicalCardId:
    "card.hash-67d8869cd0857c707456cbffeef13e8907581ac91c85c5b70d64ee7c128db452",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "Deflect 的展开文件（effects/keywords/Deflect.ts：static target.tax）已合入，但没有任何已合入消费方把永久物上的 " +
    "target.tax 持续效果接进目标选择：target/target-plan.ts 的 taxSpecs/appendTaxes 只在调用方显式传入 tax 时才追加，" +
    "chain/engine.ts 的 Finalize 虽然提供 taxAdapter 回调，但从「目标税请求」到实际收费仍依赖未合入的 " +
    "cost.pay / cost.modify（RIFT-261）；并且已合入的 tax→费用换算按 Energy 记账（chain/engine.ts:307），" +
    "而 809.1.c/809.1.c.1 要求追加费用用任意域 Power 支付。缺少的是" +
    "「持续效果 → TargetPlan 税 → 任意域 Power 支付」接线，不属于本卡的 write scope；不近似实现。" +
    "依赖：RIFT-261（cost.pay/cost.modify）与目标税消费接线。",
  abilities: [{ kind: "keyword", keyword: "deflect" }],
  sourceText:
    "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)"
} satisfies CardProgram;

export default poutyPoro;

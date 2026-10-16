import type { CardProgram } from "../../ir/index.js";

/**
 * Bird (unl-t02) — Colorless 单位 token，Might 1，标签 Bird/Token。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-t02，逐字）：
 *   [Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or
 *   ability.)
 *
 * 规则依据（CR v1.5）：
 * - 187.7：1 [M] Bird token 是无领域单位 token，1 Might、带 Bird 标签并具有 Deflect
 *   关键词；token 的 Might/标签/关键词由产生它的效果的 token 定义给出（187），
 *   不属于本卡自身的能力文本。
 * - 809.1 / 809.1.a：Deflect 是被动能力关键词，通常出现在永久物上。
 * - 809.1.b / 809.1.b.3：格式是 “Deflect [X]”，X 是 Deflect Value；省略时按 1 处理，
 *   因此 keyword 能力不带 value（默认值由关键词文件给出）。
 * - 809.1.c / 809.1.c.1：功能上等价于「对手的法术或能力每次选择我时，其打出费用增加等量、
 *   可用任意域 Power 支付的力量费用」（强制追加费用）。
 * - 809.2：多来源授予的 Deflect 数值相加（stacking: sum，由关键词文件声明）。
 * - 809.3：是否拥有 Deflect 是可被引用的特征，由 keyword 能力条目承载。
 *
 * 结构：整张卡只有关键词能力，按契约 3.1 / README 第 5 节写 `{ kind: "keyword", keyword: "deflect" }`
 * （无印刷数值，省略 value）。展开（static target.tax）由 effects/keywords/Deflect.ts 负责，
 * 卡文件不重写一套相同逻辑，也不自行推进优先权或结算链。
 *
 * status = judge-required（README 第 2 节：所需关键词依赖尚不可执行）：
 * Deflect 的展开文件已合入，但没有生产方把永久物上的 target.tax 持续效果接进目标选择——
 * target/target-plan.ts 的税只在调用方经 TargetFinalizeOptions.tax 显式传入时才追加，
 * chain 侧没有从永久物特征派生 Deflect 税；而且已合入的税→费用换算按 Energy 记账，
 * 与 809.1.c.1 要求的「任意域 Power」不符。缺口不属本卡 write scope，不近似实现。
 * 展开体本身（target.tax = 1）与 TargetPlan 的追加/拒付路径在 golden 里用已合入 API 执行。
 */
export default {
  canonicalCardId:
    "card.hash-68b515e1903e6d629eeb25b886b6f90bb791121e70c5ea72793220dd7f70e70d",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "Deflect 的展开文件（effects/keywords/Deflect.ts：static target.tax）已合入，但没有任何生产方把永久物上的 " +
    "target.tax 持续效果接进目标选择：target/target-plan.ts 的 taxSpecs/appendTaxes 只在调用方显式传入 tax 时才追加，" +
    "chain 侧也没有从永久物特征派生 Deflect 税（契约 3.8 第 4 条把目标锁定通知归引擎批 4）；" +
    "另外已合入的税→费用换算按 Energy 记账（chain/engine.ts 的 mandatoryAdditional 用 energy 常量），" +
    "而 809.1.c/809.1.c.1 要求追加费用用任意域 Power 支付。" +
    "缺少的是「持续效果 → TargetPlan 税 → 任意域 Power 支付」接线（依赖 RIFT-90 目标税 / RIFT-89 费用计划），" +
    "不属于本卡的 write scope；809.1.b.3 的默认值 1 与 target.tax 追加/拒付路径在 golden 中用已合入 API 执行。不近似实现。",
  abilities: [
    // 809.1.b.3：印刷的 [Deflect] 未写数值，X 按 1 处理，故省略 value。
    { kind: "keyword", keyword: "deflect" }
  ],
  sourceText:
    "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)"
} satisfies CardProgram;

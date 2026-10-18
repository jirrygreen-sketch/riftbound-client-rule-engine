import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Watchful Curator (rad-037-167) — Unit, 3 energy, 1 power (Calm), 4 Might, Calm.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, rad-037-167）：
 *   Your gear have [Deflect]. (Opponents must pay :rb_rune_rainbow: to choose each with a
 *   spell or ability.)
 *
 * 规则依据（CR v1.5）：
 * - 809.1 / 809.1.a：Deflect 是被动能力关键词，通常出现在 Permanents 上；809.1.b.3：印刷省略
 *   数值时按 1；809.1.c：功能文本是“对手用咒语或能力选择我时要多支付 1 点任意域力量”。
 * - 809.2：同一对象上来自多个来源的 Deflect 数值相加（Deflect Value 求和）——本句给每个
 *   友方 gear 授予 1 点，与 gear 自身可能已有的 Deflect 相加；当前 LayerEngine 的
 *   keyword grant expansion 已保留该叠加语义。
 * - 809.3：是否拥有 Deflect 是永久物的特征，可被其他游戏效果检查/引用。
 * - “Your gear”：由本卡控制者控制的 gear（190 的控制定义）；授予本身是持续效果（把关键词
 *   附加到对象上），归图层/持续效果（Contract 3.4 的 ability 图层，continuous.grant-keyword）。
 *
 * status 判定（README 第 2 节，2026-10-18 复核）：judge-required。授予 Deflect 的生产绑定与图层结算
 * 已合入，但目标选择税与收费链路仍未完成，不能把关键词可读性当作整卡可执行。
 * 当前缺口是目标税的生产接线与正确的任意域 Power 支付链路。
 * - 生产绑定：构造时 validateCardProgram 通过；createEngineStaticBinder.bindStatic 把
 *   static 能力经
 *   bindStaticToLayers 注册为 ContinuousEffectSpec（layer = effect 声明的 ability 层；
 *   staticFilter 把 controller 占位符归一为来源控制者、type/zone 白名单透传），
 *   注册对象可直接进 LayerEngine。
 * - 结算形状：continuous.grant-keyword 在结算期把 [Deflect] 写进匹配对象
 *   的关键词特征（809.3 可读、809.2 与已有 Deflect 求和）。
 * - 执行证据：golden 用解释器 + 图层引擎真实执行（含相加与可读性），并用上述生产
 *   注册路径把本卡 static 绑进真实图层引擎，断言匹配集。
 *
 * judge-required 原因：
 * - Deflect.expand、TargetTaxCostAdapter 与 any-domain Power 规划已合入，但从本卡授予的
 *   keyword expansion 到目标 Finalize 的活动税集合仍没有生产接线；target-plan.ts 的
 *   taxAdapter 只能由调用方显式提供，不能自动看到本卡授予的 Deflect。
 * - chain/engine.ts 当前仍把旧 tax callback 的金额转成 Energy mandatoryAdditional，未使用
 *   target/tax/adapter.ts 的完整 CostPlan；CR 809.1.c / 809.1.c.1 所需的任意域 Power、
 *   累计不可支付时的 Finalize/Resolve 阻断和支付回滚没有进入卡牌生产路径。
 * - ReferenceTestKernel 的 perform(pay) 仍忽略 Power 扣减，局部 payment receipt 不能作为
 *   端到端资源消费证据。
 */
const abilities: Ability[] = [
  {
    kind: "static",
    effect: {
      // “Your gear have [Deflect].” — 809.1.b.3 的省略数值按 1；授予范围是本控制者的 gear。
      kind: "continuous.grant-keyword",
      layer: "ability",
      keyword: "deflect",
      value: { kind: "constant", value: 1 },
      filter: { type: "gear", controller: "controller", zone: "board" }
    }
  }
];

const program = {
  canonicalCardId:
    "card.hash-dc5774a38ed543aac39bd40a45c96e08acddedf25a91e979a8a3576715ec1a5b",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "Deflect 的关键词展开、809.2 的叠加以及 TargetTaxCostAdapter 的 any-domain Power 规划器已合入并有独立执行证据，" +
    "但整卡仍缺生产接线：(1) CardProgram 的 static→LayerEngine grant 产生的 target.tax 没有绑定到 target Finalize；programs/statics.ts 没有把 target.tax/keyword expansion 导出为活动税集合，" +
    "因此 target-plan.ts 的 taxAdapter 只能由调用方显式提供，无法自动看到本卡授予的 Deflect；" +
    "(2) chain/engine.ts 仍使用旧的 tax callback，把每个税额写成 Energy mandatoryAdditional，未使用 target/tax/adapter.ts 的完整 CostPlan，" +
    "所以 CR 809.1.c/809.1.c.1 所需任意域 Power、累计不可支付时的 Finalize 阻断和支付回滚都没有进入卡牌生产路径；" +
    "(3) ReferenceTestKernel 的 perform(pay) 仍忽略 Power 扣减，不能把局部付款 receipt 当作端到端资源消费证据。" +
    "不近似宣称可执行。",
  abilities,
  sourceText:
    "Your gear have [Deflect]. (Opponents must pay :rb_rune_rainbow: to choose each with a spell or ability.)"
} satisfies CardProgram;

export default program;

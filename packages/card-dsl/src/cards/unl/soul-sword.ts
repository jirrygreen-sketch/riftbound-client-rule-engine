import type { CardProgram } from "../../ir/index.js";

/**
 * Soul Sword (unl-039-219) — Gear, 1 energy、power null（无印刷 Power）、Might 1，
 * 领域 Calm，标签 Equipment。
 *
 * sourceText（逐字取自 packages/card-data/data/deck-catalog.json unl-039-219）：
 *   "[Equip] :rb_rune_calm: (:rb_rune_calm:: Attach this to a unit you control.)"
 *
 * 规则依据（CR v1.5）：
 * - 818.1 / 818.1.a / 818.1.b / 818.1.b.1：Equip 是启动式能力关键词，印在带 Equipment
 *   标签的 Gear 上（本印刷 tags = ["Equipment"]）；其选择是 Target，818.1.c.2 功能
 *   等价于 "[费用]：Attach this gear to a unit you control."。
 * - 818.1.c / 818.1.c.3：本印刷的费用只有 1 个 Calm 符文符号（:rb_rune_calm:），没有
 *   能量部分；卡牌程序只声明关键词身份与印刷费用，展开由关键词注册表
 *   （effects/keywords/Equip.ts）负责（契约 3.7 与 cards/README.md 第 5 节）。
 *   costDomain 记录该 Power 的领域 Calm（沿用 sfd/warmogs-armor 等已合入字段），
 *   value: 1 记录印刷的 1 个符文符号数。
 *
 * status = judge-required（缺口不近似实现）：
 * - 已合入的 Equip 展开（effects/keywords/Equip.ts）声明的启动费用是
 *   payments: [{ kind: "equip", value: { kind: "source" } }]，而 cost/plan-values.ts 的
 *   readCost 对未知支付种类直接 blocked，实测 buildCostPlan 抛 CostPlanError
 *   （reason "judge-required"，message "Unsupported payment kind: equip"）——印刷的
 *   1 Calm Power 目前无法通过既有费用管线支付，本印刷又不含能量部分，没有可退化的支付路径。
 *   （Ogn 侧的卡牌级测试仍在跑 Equip 的展开体：attach 目标与 effect.attach 都已合入，
 *   golden 用真实解释器让装备附着到所选单位；缺口只在费用。）
 * - 缺少卡牌程序 → 关键词展开 → 时点/链的接线（契约 3.5）：programs/ 的适配器没有
 *   运行时调用方，没有人把 KeywordAbility 交给 keyword 注册表展开并注册到链上（RIFT-257）。
 * 不把 Equip 近似成裸 effect.attach（那会绕开 818.1.c.3/c.4 的费用与费用改写语义），
 * 也不新增 IR 参数键。
 *
 * 依赖：Equip 费用支付种类与费用管线扩展（RIFT-89 后续）以及关键词接线（RIFT-257）。
 */
export default {
  canonicalCardId:
    "card.hash-87e2eedcbebff6711e1c1841d161efbe5d63d047836446fb4ececd034911f1be",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "Equip 的启动费用尚不能在费用管线里支付：已合入的 Equip 展开（effects/keywords/Equip.ts）声明 " +
    "payments: [{ kind: \"equip\", value: { kind: \"source\" } }]，而 cost/plan-values.ts 的 readCost 对未知支付种类直接 blocked，" +
    "实测 buildCostPlan 抛 CostPlanError（reason \"judge-required\"，message \"Unsupported payment kind: equip\"）；" +
    "本印刷的 Equip 费用是 1 个 Calm 符文符号（818.1.c 的 [Cost] 部分），不含能量部分，因此没有可退化的支付路径。" +
    "缺口的另一半是接线：程序侧的适配器（programs/）没有运行时调用方，没有人把本卡的 KeywordAbility 交给关键词注册表展开并注册到链上（RIFT-257）；" +
    "展开体本身可用——effect.attach 与目标选择都已合入，golden 用真实解释器让装备附着到所选单位。" +
    "依赖：Equip 费用支付种类与费用管线扩展（RIFT-89 后续）以及关键词接线（RIFT-257）；不近似实现。",
  abilities: [
    // 818.1.c：印刷费用为 1 个 Calm 符文符号（= 1 Calm Power），无能量符号。
    { kind: "keyword", keyword: "equip", value: 1, costDomain: "Calm" }
  ],
  sourceText:
    "[Equip] :rb_rune_calm: (:rb_rune_calm:: Attach this to a unit you control.)"
// costDomain 是既有合入先例使用的扩展字段（sfd/warmogs-armor 同样以 `as const` 书写）：
// 冻结的 KeywordAbility（契约 3.1）只有 kind/keyword/value，没有承载印刷关键词费用参数的
// 槽位（契约 3.8.3 的 params 只加在 KeywordDef.expand 的输入上）。这里沿用 `as const`
// 的既有写法，并在回复中记录契约变更请求。
} as const;

import type { CardProgram } from "../../ir/index.js";

/**
 * Nazuman Ntofo (rad-071-167) — Gear, 1 energy、power null（无印刷 Power）、Order。
 *
 * sourceText（逐字取自 packages/card-data/data/deck-catalog.json rad-071-167）：
 *   "Equip :rb_energy_1: (:rb_energy_1:: Attach this to a unit you control.)"
 *
 * 规则依据（CR v1.5）：
 * - 818.1 / 818.1.b / 818.1.b.1 / 818.1.c / 818.1.c.2：Equip 是启动式能力关键词，
 *   功能上等于「[费用]：把此装备附着到你控制的一个单位上」，选择单位是 Target。
 * - 本卡印刷的 Equip 费用只有 1 个能量符号（:rb_energy_1:），没有 Power 部分；
 *   按契约 3.7 / README 第 5 节，卡牌程序只声明关键词与印刷数值：value 记录印刷的
 *   能量符号数 1；费用里没有 Power，因此不写 costDomain。
 *
 * status：judge-required。已合入的 Equip 展开（RIFT-87，effects/keywords/Equip.ts）
 * 结构与契约相符（golden 断言其展开结果可通过 validateCardProgram），但展开声明的
 * 激活费用 payments: [{ kind: "equip" }] 在当前 EffectIR 费用管线里被判为不支持：
 * cost/plan-values.ts 的 readCost 对未知支付种类调用 blocked(...)，实测 buildCostPlan
 * 抛 CostPlanError（reason "judge-required"，message "Unsupported payment kind: equip"）。
 * 也就是说 Equip 的启动费用目前无法在费用管线里支付，并且还缺少卡牌程序 → 关键词展开
 * → 时点/链的接线（契约 3.5）。不把 Equip 近似成一条裸 effect.attach 指令（那会绕开
 * 818.1.c.3/c.4 的费用与费用改写语义）。
 *
 * 数据提示（本任务不改数据）：本地 deck-catalog 中本印刷 tags 为空数组，而 CR 818.1.a
 * 规定 Equip 出现在带 Equipment 标签的 Gear 上（同批其他 Equip 卡均带 Equipment 标签）。
 * 详见本任务最终回复的「数据问题」。
 */
export default {
  canonicalCardId: "card.hash-bbba13a99fc64b76e1aea5bf99acad154b4526f0661f19a3ac11162fced5801a",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "Equip 的启动费用尚不能在 EffectIR 费用管线里支付：已合入的 Equip 展开（RIFT-87）声明 " +
    "payments: [{ kind: \"equip\" }]，而 cost/plan-values.ts readCost 对未知支付种类直接 " +
    "blocked，实测 buildCostPlan 抛 CostPlanError reason \"judge-required\"" +
    "（Unsupported payment kind: equip）；同时缺少卡牌程序→关键词展开→时点/链的接线（契约 3.5）。" +
    "依赖：Equip 费用支付原语 / 费用管线扩展（费用计划后续任务）与关键词接线。不近似实现。",
  abilities: [
    // 818.1.c："[费用]: Attach this to a unit you control."。印刷费用为 1 能量、无 Power，
    // 故只记 value: 1（印刷能量符号数），不写 costDomain。
    { kind: "keyword", keyword: "equip", value: 1 }
  ],
  sourceText:
    "Equip :rb_energy_1: (:rb_energy_1:: Attach this to a unit you control.)"
} satisfies CardProgram;

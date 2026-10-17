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
 * status = judge-required（2026-10-17 复核）。已合入的 Equip 展开与 effect.attach
 * 有真实执行证据，但 payment kind "equip" 仍被 cost/plan-values.ts 拒绝
 * （Unsupported payment kind: equip）。本地目录 tags 为空也会使 duel Equip admission
 * 报告 not-equipment-tag；这是 card-data 数据问题，不在本卡任务范围修复。
 * 不把 Equip 近似成裸 effect.attach，也不修改 energy:null/power:null 等印刷数据。
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
    "2026-10-17 复核：Equip 的展开与 effect.attach 已有真实执行证据；当前缺口是费用管线" +
    "拒绝展开声明的 payments: [{ kind: \"equip\" }]，cost/plan-values.ts readCost 实测抛出" +
    "CostPlanError（Unsupported payment kind: equip）。本地 card-data 还把本印刷 tags 记为空数组，" +
    "duel Equip admission 会报告 not-equipment-tag；这是数据问题，不在本卡任务范围修复。" +
    "不把 Equip 近似成裸 effect.attach。",
  abilities: [
    // 818.1.c："[费用]: Attach this to a unit you control."。印刷费用为 1 能量、无 Power，
    // 故只记 value: 1（印刷能量符号数），不写 costDomain。
    { kind: "keyword", keyword: "equip", value: 1 }
  ],
  sourceText:
    "Equip :rb_energy_1: (:rb_energy_1:: Attach this to a unit you control.)"
} satisfies CardProgram;

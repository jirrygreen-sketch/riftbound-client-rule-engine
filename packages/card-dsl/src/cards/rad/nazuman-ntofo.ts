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
 * status = judge-required（2026-10-17 复核）。已合入的 Equip 展开（RIFT-87，effects/keywords/Equip.ts）
 * 结构与契约相符（golden 断言其展开结果可通过 validateCardProgram、body 用已合入的
 * effect.attach 真实附着），但展开声明的激活费用 payments: [{ kind: "equip" }] 在当前 EffectIR
 * 费用管线里被判为不支持：cost/plan-values.ts 的 readCost 对未知支付种类调用 blocked(...)，
 * 实测 buildCostPlan 抛 CostPlanError（reason "judge-required"，message "Unsupported payment kind: equip"）。
 * 已有先例（sfd/hextech-gauntlets、sfd/shepherds-heirloom）按同一口径把该费用缺口记为 todo，
 * 不再把「管线缺 equip」当作新发现的缺口。
 * 仍未接线的部分：卡牌程序 → 关键词展开 → 链/时点的生产者（契约 3.5）：没有已合入路径把
 * CardProgram 的 keyword 能力展开并注册（引擎不读取卡牌能力，RIFT-257）。
 * 不把 Equip 近似成一条裸 effect.attach 指令（那会绕开 818.1.c.3/c.4 的费用与费用改写语义）。
 * 依赖：equip 费用种类（RIFT-261 费用种类/费用管线）、RIFT-257。
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
    "2026-10-17 复核：已合入的 Equip 展开（RIFT-87）声明的 payments: [{ kind: \"equip\" }] 仍不能被费用管线受理——" +
    "cost/plan-values.ts readCost 对未知支付种类直接 blocked，实测 buildCostPlan 抛 CostPlanError reason \"judge-required\"" +
    "（Unsupported payment kind: equip）；本卡不把 Equip 近似为裸 effect.attach。" +
    "同时缺少卡牌程序 → 关键词展开 → 链/时点的生产者：没有已合入路径把 CardProgram 的 keyword 能力展开并注册（契约 3.5；RIFT-257）。" +
    "依赖：equip 费用种类 / 费用管线扩展（RIFT-261）、关键词接线（RIFT-257）。不近似实现。",
  abilities: [
    // 818.1.c："[费用]: Attach this to a unit you control."。印刷费用为 1 能量、无 Power，
    // 故只记 value: 1（印刷能量符号数），不写 costDomain。
    { kind: "keyword", keyword: "equip", value: 1 }
  ],
  sourceText:
    "Equip :rb_energy_1: (:rb_energy_1:: Attach this to a unit you control.)"
} satisfies CardProgram;

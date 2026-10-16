import type { CardProgram } from "../../ir/index.js";

/**
 * Jagged Cutlass (ven-073-166) — Gear, 3 Energy, no printed Power, Might 2,
 * Body, tag Equipment.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-073-166，逐字）：
 *   "Equip :rb_rune_body: (:rb_rune_body:: Attach this to a unit you control.)"
 *
 * 规则依据（Core Rules v1.5）：
 * - 818.1 / 818.1.a：Equip 是带 Equipment 标签的 Gear 上的启动式能力关键词。
 * - 818.1.b / 818.1.b.1 / 818.1.b.2：Equip 有启动费用，成功附着时把本牌附着到
 *   被选择的单位上，该单位成为 Top-Most Card，且所选单位是 Target。
 * - 818.1.c / 818.1.c.2：格式为 "Equip [Cost]"，功能上等价于
 *   "[费用]：把此装备附着到你控制的一个单位上"。
 * - 135.2.e.4：:rb_rune_body: 是 Body 域的 Power 符号；本卡印刷的 Equip 费用只有
 *   1 个 Body 符文，没有能量符号（卡面 3 Energy 是打出费用，不是 Equip 费用）。
 *
 * status = judge-required（与 sfd/boneshiver、rad/nazuman-ntofo 同源缺口）：
 * 1. 卡牌程序 → 关键词展开 → 时点/链的接线（契约 3.5）尚未合入，印刷的 Equip 费用
 *    也无法送达 KeywordDef.expand（契约 3.8.3 的 params.cost 未实现）；
 * 2. 已合入的 Equip 展开（RIFT-87，effects/keywords/Equip.ts）声明
 *    cost.payments [{ kind: "equip" }]，而 cost/plan-values.ts 的 readCost 对未知支付
 *    种类直接 blocked——实测 buildCostPlan 抛 CostPlanError（reason "judge-required"，
 *    message "Unsupported payment kind: equip"）。因此启动费用目前不可支付。
 * 已合入的 effect.attach 本体（818.1.c.2 的附着）由 golden 用真实解释器执行；
 * 这不使整卡可执行。依赖：Equip 费用支付种类（RIFT-89 费用计划后续）与关键词接线。
 */
const equip = {
  // 印刷 "Equip :rb_rune_body:"：1 个符文符号（Body Power）。value 记录印刷符号数，
  // costDomain 记录该符文的领域（与 sfd/boneshiver、sfd/bf-sword 同一约定）。
  kind: "keyword",
  keyword: "equip",
  value: 1,
  costDomain: "Body"
} as const;

export default {
  canonicalCardId: "card.hash-2c2d2ea79ffc4ad60c612406b6e615a62c4219ad076ec64e1c6d09747c71e39e",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "[Equip] 目前无法执行：(1) 卡牌程序 → 关键词展开 → 链的接线（契约 3.5）未合入，" +
    "印刷费用（1 个 Body 符文，CR 818.1.c/135.2.e.4）也无法送达 KeywordDef.expand，" +
    "已合入的展开签名只有 value/host（契约 3.8.3 的 params.cost 未实现）；" +
    "(2) 已合入的 effects/keywords/Equip.ts 展开声明 cost.payments [{ kind: \"equip\" }]，" +
    "cost/plan-values.ts 的 readCost 对未知支付种类调用 blocked，实测 buildCostPlan 抛 CostPlanError" +
    "（reason \"judge-required\"，message \"Unsupported payment kind: equip\"，RIFT-89 费用计划批次）。" +
    "已合入的 effect.attach 附着本体由 golden 真实执行，但启动费用不可支付，整卡不可执行。" +
    "不近似实现（不写成裸 effect.attach 指令绕开 818.1.c.3/c.4 的费用语义）。",
  abilities: [equip],
  sourceText: "Equip :rb_rune_body: (:rb_rune_body:: Attach this to a unit you control.)"
} satisfies CardProgram;

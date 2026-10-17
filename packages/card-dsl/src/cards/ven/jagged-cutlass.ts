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
 * 复核（2026-10-17，RIFT-613 第三轮 M2 覆盖率复核，实测见 test.mjs 的 probe 用例）：
 * 1. KeywordDef.expand 的接口已经声明可选 params.cost，但冻结的 CardProgram
 *    KeywordAbility 只有 keyword/value；本卡的 costDomain 是既有描述性扩展字段，
 *    不是 CostSpec，且 programs/keywords.ts 的 expandProgram 仍只传 value/host，
 *    没有把卡牌费用转发到 params.cost；
 * 2. effects/keywords/Equip.ts 当前 expand 不读取 params.cost，只生成
 *    cost.payments [{ kind: "equip", value: { kind: "constant", value: { kind: "source" } } }]；
 *    cost/plan-values.ts 的 readCost 对该支付种类仍直接 blocked——实测 buildCostPlan 抛
 *    CostPlanError（reason "judge-required"，message "Unsupported payment kind: equip"），
 *    因此启动费用目前不可支付。
 * 已合入的卡牌程序 → 关键词展开 → 链接线（programs/）与 effect.attach 本体
 * （818.1.c.2 的附着）由 golden 用真实绑定/解释器执行；这不使整卡可执行。
 * 依赖：KeywordAbility 的印刷费用参数承载、programs/keywords.ts 的 params.cost 转发、
 * effects/keywords/Equip.ts 的费用读取，以及 cost/plan-values.ts 的 "equip" 支付消费。
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
    "[Equip] 目前无法执行（2026-10-17 RIFT-613 复核实测）：(1) KeywordDef.expand 已声明可选 params.cost，但冻结的 " +
    "CardProgram KeywordAbility 只有 keyword/value；本卡的 costDomain 是描述性扩展字段，不是 CostSpec，" +
    "且 programs/keywords.ts 的 expandProgram 仍只传 value/host，没有把卡牌费用转发到 params.cost；" +
    "(2) effects/keywords/Equip.ts 的 expand 不读取 params.cost，只生成 cost.payments " +
    "[{ kind: \"equip\", value: { kind: \"constant\", value: { kind: \"source\" } } }]；" +
    "cost/plan-values.ts 的 readCost 对该支付种类调用 blocked，实测 buildCostPlan 抛 CostPlanError" +
    "（reason \"judge-required\"，message \"Unsupported payment kind: equip\"），因此启动费用目前不可支付。" +
    "已合入的 programs/ 卡牌程序绑定与 effect.attach 附着本体由 golden 真实执行，但印刷费用承载、展开转发与 Equip 支付消费仍缺失。" +
    "不近似实现（不写成裸 effect.attach 指令绕开 818.1.c.3/c.4 的费用语义）。",
  abilities: [equip],
  sourceText: "Equip :rb_rune_body: (:rb_rune_body:: Attach this to a unit you control.)"
} satisfies CardProgram;

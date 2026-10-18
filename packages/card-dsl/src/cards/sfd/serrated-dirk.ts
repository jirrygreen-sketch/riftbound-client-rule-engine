/**
 * Serrated Dirk （sfd-009-221）— Gear，1 energy、power null（无印刷 Power），Might 0，
 * Fury，Equipment。
 *
 * sourceText（逐字取自 packages/card-data/data/deck-catalog.json sfd-009-221）：
 *   "[Equip] :rb_rune_fury: (:rb_rune_fury:: Attach this to a unit you control.)"
 *
 * 规则依据（CR v1.5）：
 * - 818.1 / 818.1.b：Equip 是启动式能力关键词，支付费用后把带此关键词的卡附着到所选单位；
 *   818.1.b.1 该选择是 Target，818.1.b.2 被选单位成为 Attach 动作的 Top-Most Card。
 * - 818.1.c / 818.1.c.2：格式为 "Equip [费用]"，功能上等于「[费用]：把此装备附着到 you
 *   control 的一个单位」。本卡印刷的 Equip 费用是 1 点 Fury Power（135.2.e.4 的领域符号），
 *   沿用同目录已合入装备程序（long-sword、bf-sword 等）的记录约定：value 记印刷的 Power
 *   数量 1，costDomain 记该 Power 的领域 "Fury"。印刷的 1 energy 是 Gear 的打出费用
 *   （150.4），不是 Equip 费用。
 * - 150.1–150.3：Equipment 是带 Equipment 标签的 Gear，可以有 Equip；本地 catalog 的
 *   tags 为 ["Equipment"]，与 818.1.a 一致。
 *
 * status = judge-required：Equip 展开、启动草稿与 effect.attach 已存在，仍缺本卡的装备费绑定。
 * programs/keywords.ts 未将印刷的 1 Fury Power 传入 params.cost，Equip.ts 也未消费该参数，
 * 而是生成 { kind: "equip" } 支付项；cost/plan-values.ts::readCost 不支持该支付种类。
 * cost.pay / cost.modify 的存在不等于 818.1.b / 818.1.c.2–4 的装备费已接入 Finalize，
 * 因而保留关键词声明，不用裸 effect.attach 绕过费用。
 */
export default {
  canonicalCardId: "card.hash-2d46595233b37a0868857eab035ad4fa4dc53fc8c932d35ad32cca2c54ff06d2",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺 [Equip] 印刷费用到启动 Finalize 的绑定（CR 818.1.b、818.1.c.2–4）：" +
    "programs/keywords.ts 未把本卡的 1 Fury Power 从 value/costDomain 传入 expand params.cost；" +
    "effects/keywords/Equip.ts 也未消费 params.cost，仍生成 { kind: \"equip\" } 支付项，" +
    "cost/plan-values.ts::readCost 因 Unsupported payment kind: equip 而阻断。" +
    "不能用 Gear 的印刷打出费用（1 Energy、Power null）代替装备费，也不能用裸 effect.attach 绕过费用。",
  abilities: [
    { kind: "keyword", keyword: "equip", value: 1, costDomain: "Fury" }
  ],
  sourceText:
    "[Equip] :rb_rune_fury: (:rb_rune_fury:: Attach this to a unit you control.)"
} as const;

/**
 * Doran's Shield （sfd-033-221）— Gear，1 energy、power null（无印刷 Power），Might 1，
 * Calm，Equipment。
 *
 * sourceText（逐字取自 packages/card-data/data/deck-catalog.json sfd-033-221）：
 *   "[Equip] :rb_rune_calm: (:rb_rune_calm:: Attach this to a unit you control.)"
 *
 * 规则依据（CR v1.5）：
 * - 818.1 / 818.1.b：Equip 是启动式能力关键词，支付费用后把带此关键词的卡附着到所选单位；
 *   818.1.b.1 该选择是 Target，818.1.b.2 被选单位成为 Top-Most Card。
 * - 818.1.c / 818.1.c.2：格式为 "Equip [费用]"，功能上等于「[费用]：把此装备附着到 you
 *   control 的一个单位」。本卡印刷的 Equip 费用是 1 点 Calm Power（135.2.e.4），沿用同目录
 *   已合入装备程序的约定：value 记印刷的 Power 数量 1，costDomain 记领域 "Calm"；印刷的
 *   1 energy 是 Gear 的打出费用（150.4），不是 Equip 费用。
 * - 150.1–150.3：Equipment 是带 Equipment 标签的 Gear，可以有 Equip；本地 catalog 的
 *   tags 为 ["Equipment"]，与 818.1.a 一致。
 *
 * status = judge-required（复核 2026-10-17）：Equip 的印刷费用尚未接进费用计划（818.1.c.2）。
 * KeywordDef.params.cost 已有契约入口，但 Equip.expand 不读取它，programs/keywords.ts
 * 也没有把本卡的 Calm 费用传给展开；cost/plan-values.ts 的 readCost 对 equip 支付种类
 * 直接 blocked("Unsupported payment kind: equip")。
 * 卡牌程序、关键词展开与启动链路已合入，effect.attach 的执行测试覆盖附着部分。
 */
export default {
  canonicalCardId: "card.hash-6ef5f0dfecb89d68422cd4fa23ea64d155ef384d03c974ea67ff920203e89a46",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "印刷的 [Equip] 费用（1 点 Calm Power，CR 818.1.c.2）尚无可支付绑定：" +
    "Equip.expand 仍声明 payments: [{ kind: \"equip\", value: { kind: \"source\" } }]，" +
    "cost/plan-values.ts 的 readCost 实测抛出 CostPlanError（reason \"judge-required\"，" +
    "message \"Unsupported payment kind: equip\"），因此本卡的 Calm Power 不能组成可支付的 Equip 计划；" +
    "KeywordDef.params.cost 虽已声明（契约 3.8 第 3 条），programs/keywords.ts 只向 expand 传 value/host，" +
    "Equip.expand 也不读取它，印刷费用无法到达展开体。" +
    "已合入并由 golden 真实执行的部分是 effect.attach 的附着与失效目标处理，不等于 Equip 启动可用。",
  abilities: [
    { kind: "keyword", keyword: "equip", value: 1, costDomain: "Calm" }
  ],
  sourceText:
    "[Equip] :rb_rune_calm: (:rb_rune_calm:: Attach this to a unit you control.)"
} as const;

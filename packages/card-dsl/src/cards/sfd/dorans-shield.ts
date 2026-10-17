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
 * status = judge-required：Equip 的印刷费用尚未接进费用计划（818.1.c.2）。
 * KeywordDef.params.cost 已有契约入口，但 Equip.expand 不读取它，programs/keywords.ts
 * 也没有把本卡的 Calm 费用传给展开；cost/plan-values.ts 不支持 equip 支付种类。
 * 卡牌程序、关键词展开与启动链路已合入，effect.attach 的执行测试覆盖附着部分。
 */
export default {
  canonicalCardId: "card.hash-6ef5f0dfecb89d68422cd4fa23ea64d155ef384d03c974ea67ff920203e89a46",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "印刷的 [Equip] 费用（1 点 Calm Power，CR 818.1.c.2）尚无可支付绑定：" +
    "Equip.expand 仍声明 payments: [{ kind: \"equip\", value: source }]，cost/plan-values.ts 的 readCost 不支持 equip 支付种类；" +
    "KeywordDef.params.cost 虽已声明，programs/keywords.ts 未传入印刷费用，Equip.expand 也不读取它。" +
    "需补齐印刷 Equip 费用到费用计划的绑定（契约 3.8 第 3 条）。",
  abilities: [
    { kind: "keyword", keyword: "equip", value: 1, costDomain: "Calm" }
  ],
  sourceText:
    "[Equip] :rb_rune_calm: (:rb_rune_calm:: Attach this to a unit you control.)"
} as const;

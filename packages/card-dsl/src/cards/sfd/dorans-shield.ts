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
 * status = judge-required（缺可支付的费用路径与关键词接线，不近似实现）：
 * - 已合入的 Equip 展开声明 payments: [{ kind: "equip", value: source }]，费用管线
 *   cost/plan-values.ts 的 readCost 没有 "equip" 这一支付种类（Equip 费用属未合入的
 *   RIFT-261 费用指令批次），启动费用无法计算/支付。
 * - 契约 3.8 第 3 条要求 expand 用 params.cost 承载印刷装备费，已合入的 KeywordDef 接口
 *   虽声明了 params，但 Equip 展开只用 value/host，印刷的 Calm 符文没有落到 expand；
 *   卡牌程序 → 关键词展开 → 时点/链的接线（契约 3.5）未合入（卡牌程序绑定 RIFT-257）。
 * - 依赖：RIFT-261（Equip 费用与 cost.* 指令）、RIFT-257（卡牌程序关键词展开绑定）。不近似实现。
 */
export default {
  canonicalCardId: "card.hash-6ef5f0dfecb89d68422cd4fa23ea64d155ef384d03c974ea67ff920203e89a46",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "印刷的 [Equip] 费用（1 点 Calm Power，818.1.c.2）目前无法支付：已合入的 Equip 展开" +
    "（RIFT-87，effects/keywords/Equip.ts）声明 payments: [{ kind: \"equip\", value: source }]，" +
    "费用管线 cost/plan-values.ts 的 readCost 没有 \"equip\" 支付种类，启动费用无法计算/支付；" +
    "契约 3.8 第 3 条要求 expand 用 params.cost 承载印刷装备费，已合入的 KeywordDef 虽声明了 params，" +
    "但 Equip 展开只用 value/host，印刷的 Calm 符文没有落到 expand 参数上；" +
    "也缺卡牌程序→关键词展开→时点/链的接线（契约 3.5）。" +
    "依赖：RIFT-261（Equip 费用支付与 cost.* 指令）、RIFT-257（卡牌程序关键词展开绑定）。" +
    "不近似实现（不把 Equip 降级成裸 effect.attach）。",
  abilities: [
    { kind: "keyword", keyword: "equip", value: 1, costDomain: "Calm" }
  ],
  sourceText:
    "[Equip] :rb_rune_calm: (:rb_rune_calm:: Attach this to a unit you control.)"
} as const;

import type { CardProgram } from "../../ir/index.js";

/**
 * Blighted Battleaxe (unl-019-219) — Gear, 4 energy、power null（无印刷 Power）、
 * Might 4，领域 Fury，标签 Equipment。
 *
 * sourceText（逐字取自 packages/card-data/data/deck-catalog.json unl-019-219）：
 *   "[Equip] :rb_energy_1::rb_rune_fury: (:rb_energy_1::rb_rune_fury:: Attach this
 *    to a unit you control.)"
 *
 * 规则依据（CR v1.5）：
 * - 818.1 / 818.1.a / 818.1.b：Equip 是启动式能力关键词，出现在带 Equipment 标签的
 *   Gear 上（本印刷 tags = ["Equipment"]，与本地目录一致）。
 * - 818.1.b.1 / 818.1.c.2：选择的单位是 Target，功能等价于
 *   "[费用]：Attach this gear to a unit you control."，展开由关键词注册表负责
 *   （effects/keywords/Equip.ts，契约 3.7）；卡牌程序只声明关键词身份与印刷费用。
 * - 818.1.c.3：Equip 费用可包含资源费用与非资源费用；本印刷是 1 个能量符号
 *   （:rb_energy_1:）加 1 个 Fury 符文符号（:rb_rune_fury:）。按 README 第 5 节的
 *   既有先例（sfd/long-sword、sfd/bf-sword），value 记录印刷的 Power 符号数 1，
 *   costDomain 记录该 Power 的领域 Fury；能量符号数不在 KeywordAbility 的
 *   冻结字段里（见回复的契约变更请求）。
 *
 * status = judge-required：
 * - 已合入的 Equip 展开（RIFT-87，effects/keywords/Equip.ts）声明的启动费用是
 *   payments: [{ kind: "equip" }]，而 cost/plan-values.ts 的 readCost 对未知支付种类
 *   直接 blocked，实测 buildCostPlan 抛 CostPlanError（reason "judge-required"，
 *   message "Unsupported payment kind: equip"）——印刷费用目前无法支付；
 * - 缺少卡牌程序 → 关键词展开 → 时点/链的接线（契约 3.5）：没有生产方把 KeywordAbility
 *   交给 keyword 注册表展开并注册到链上（效果类卡片的 §2 status 判定：仅能写出声明不算
 *   executable）。
 * 不把 Equip 近似成一条裸 effect.attach 指令（那会绕开 818.1.c.3/c.4 的费用与费用改写
 * 语义）；也不新增 IR 参数键。
 *
 * 依赖：Equip 费用支付种类（cost/plan-values.ts 的 "equip"，RIFT-89 后续）与关键词接线。
 */
// `costDomain` 是既有合入先例使用的扩展字段（sfd/long-sword、sfd/bf-sword、
// sfd/warmogs-armor 同样以 `as const` 书写）：冻结的 KeywordAbility（契约 3.1）只有
// kind/keyword/value，没有承载印刷关键词费用参数的槽位（契约 3.8.3 的 params 只加在
// KeywordDef.expand 的输入上），这里沿用 `as const` 的既有写法，并在回复中记录契约变更请求。
// costDomain 是既有合入先例使用的扩展字段（sfd/long-sword、sfd/bf-sword 同样以
// `as const` 书写）：冻结的 KeywordAbility（契约 3.1）只有 kind/keyword/value，没有
// 承载印刷关键词费用参数的槽位（契约 3.8.3 的 params 只加在 KeywordDef.expand 的输入
// 上）。这里沿用既有写法，并在回复中记录契约变更请求。
export default {
  canonicalCardId:
    "card.hash-21de7fcaef3e38ea7173a7b6b370c00cc4d0e2893c34cafde3a98ee7b65ac558",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "Equip 的启动费用尚不能在 EffectIR 费用管线里支付：已合入的 Equip 展开（effects/keywords/Equip.ts，RIFT-87）声明 " +
    "payments: [{ kind: \"equip\" }]，而 cost/plan-values.ts 的 readCost 对未知支付种类直接 blocked，" +
    "实测 buildCostPlan 抛 CostPlanError（reason \"judge-required\"，message \"Unsupported payment kind: equip\"）；" +
    "印刷费用里也没有承载能量符号数的冻结字段（本印刷为 1 能量 + 1 Fury Power）。" +
    "其次缺少卡牌程序→关键词展开→时点/链的接线（契约 3.5）：没有生产方把 KeywordAbility 交给 keyword 注册表展开并注册到链上。" +
    "依赖：Equip 费用支付种类与费用管线扩展（RIFT-89 后续）以及关键词接线；不近似实现，" +
    "不用裸 effect.attach 绕开 818.1.c.3/c.4 的费用语义。",
  abilities: [
    // 818.1.a：本印刷带 Equipment 标签；818.1.c：印刷费用为 1 能量 + 1 Fury Power，
    // KeywordAbility 只记录 Power 部分（value = 印刷 Power 符号数，costDomain = 领域）。
    { kind: "keyword", keyword: "equip", value: 1, costDomain: "Fury" }
  ],
  sourceText:
    "[Equip] :rb_energy_1::rb_rune_fury: (:rb_energy_1::rb_rune_fury:: Attach this to a unit you control.)"
} as const;

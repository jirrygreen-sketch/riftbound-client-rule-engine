/**
 * Skyfall of Areion （sfd-030-221）— Gear，3 energy、power null，Might 2，Fury，Equipment。
 *
 * sourceText（逐字取自 packages/card-data/data/deck-catalog.json sfd-030-221）：
 *   "[Equip] :rb_energy_1::rb_rune_fury: (:rb_energy_1::rb_rune_fury:: Attach this to a unit you control.)"
 *
 * 规则依据（CR v1.5）：
 * - 818.1 / 818.1.b：Equip 是启动式能力关键词，支付费用后把带此关键词的卡附着到所选单位；
 *   818.1.b.1 该选择是 Target。
 * - 818.1.c / 818.1.c.3：格式为 "Equip [费用]"，818.1.c.3 明确 Equip 费用可以同时包含资源与
 *   非资源部分。本卡印刷的 Equip 费用是 1 energy + 1 点 Fury Power：KeywordAbility 只有
 *   数值字段（value），沿用同目录已合入装备程序的约定记印刷的 Power 数量 1 与领域 "Fury"；
 *   印刷的 1 energy 部分没有独立字段：KeywordDef 接口已有契约 3.8 第 3 条的 params.cost，
 *   但 programs/keywords.ts 的 expandProgram 还没有把它从 KeywordAbility 传下去，
 *   因此本卡在 judgeReason 中同时记录费用无法完整表达、也无法支付。
 * - 150.1–150.3：Equipment 是带 Equipment 标签的 Gear，可以有 Equip；本地 catalog 的
 *   tags 为 ["Equipment"]，与 818.1.a 一致。
 *
 * status = judge-required（缺可支付的费用路径，不近似实现）。已合入的部分：KeywordDef.expand 的
 * params（契约 3.8 第 3 条）、Equip KeywordDef（RIFT-87）与 CardProgram 绑定（RIFT-257）——
 * describeActivate 能为本卡给出带 { kind: "equip" } 支付分量的启动草稿，展开体末步的
 * effect.attach 也真实附着（golden 执行）。仍然缺的部分：
 * - 费用管线 cost/plan-values.ts 的 readCost 对未知支付种类直接 blocked：golden 实测
 *   buildCostPlan 抛 CostPlanError（reason "judge-required"，message
 *   "Unsupported payment kind: equip"）；该形状连 818.1.c.3 的 1 energy 部分都表达不了。
 * - 印刷的 1 energy + 1 Fury Power 也还没有从 KeywordAbility 流到 expand 的 params.cost 的调用方
 *   （programs/keywords.ts 的 expandProgram 只传 value/host）。
 * 依赖：Equip 支付种类的费用管线支持（含混合费用）。不近似实现。
 */
export default {
  canonicalCardId: "card.hash-63dae663a2ca549dc4704d2814cdc3b2eea4a26845d09029e88d2c8df6ee0013",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "印刷的 [Equip] 费用是 1 energy + 1 点 Fury Power（818.1.c.3 允许资源与非资源混合），仍无法支付；" +
    "缺失环节已收窄到费用管线：KeywordDef.expand 的 params（契约 3.8 第 3 条）、Equip KeywordDef（RIFT-87）" +
    "与 CardProgram 绑定（RIFT-257）都已合入——describeActivate 能返回带着 { kind: \"equip\" } 支付分量的启动草稿，" +
    "展开体末步 effect.attach 也真实执行。费用管线 cost/plan-values.ts 的 readCost 仍对未知支付种类直接 blocked —— " +
    "golden 实测 buildCostPlan 抛 CostPlanError（reason \"judge-required\"，message \"Unsupported payment kind: equip\"），" +
    "该形状连 1 energy 部分都表达不了；同时印刷费用还没有从 KeywordAbility 流到 expand 的 params.cost 的调用方" +
    "（programs/keywords.ts 只传 value/host）。依赖：Equip 支付种类的费用管线支持（含混合费用）。不近似实现。",
  abilities: [
    { kind: "keyword", keyword: "equip", value: 1, costDomain: "Fury" }
  ],
  sourceText:
    "[Equip] :rb_energy_1::rb_rune_fury: (:rb_energy_1::rb_rune_fury:: Attach this to a unit you control.)"
} as const;

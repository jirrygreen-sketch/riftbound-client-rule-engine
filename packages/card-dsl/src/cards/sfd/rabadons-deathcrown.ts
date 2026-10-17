import type { CardProgram } from "../../ir/index.js";

/**
 * Rabadon's Deathcrown (sfd-191-221) — Gear, 4 Energy + 2 Power, Might 3
 * (Calm/Mind), tags Ornn / Equipment / Signature.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, sfd-191-221，逐字）:
 *   [Unique] (Your deck can have only 1 card with this name.)
 *   [Equip] :rb_rune_rainbow: (:rb_rune_rainbow:: Attach this to a unit you control.)
 *
 * 规则依据（CR v1.5）：
 * - 825.1/825.2/825.3：[Unique] 是 Deck Constraint Permission（同名每副牌组 1 张），
 *   825.4 明确本体游戏过程中没有额外效果。
 * - 818.1/818.1.b/818.1.b.1/818.1.c.2：[Equip] 是启动式能力关键词，功能等价于
 *   「[费用]：把此装备附着到你控制的一个单位」；印刷费用 1 点 :rb_rune_rainbow: 是
 *   135.2.e.5/163.2.b 的任意域（Universal）Power [A]。选择的单位是 Target（契约 3.6）。
 *
 * 数据问题（本任务不改数据，按题卡要求记录）：CR v1.5 715.4 的示例写 "He has Rabadon’s
 * Deathcrown attached to him. … Although the ability has 3 Bonus Damage from Rabadon’s
 * Deathcrown …"，即规则正文按“本装备提供 3 点 Bonus Damage”描述本卡；而本地 deck-catalog
 * （sfd-191-221）的 ability 只有 [Unique] 与 [Equip] 两行，没有任何 Bonus Damage 文本
 * （v1.4 4196 行的同一条示例同样如此）。按“无来源证据不得补全效果”的红线，本程序严格保留
 * 目录原文，不自行加入 Bonus Damage 能力，把该原文差异列入 judgeReason 交裁定。
 *
 * status = judge-required（README 第 2 节；逐项列出，不近似实现）：
 * - [Unique] 无已合入 KeywordDef（effects/keywords/ registry 的 26 个关键词不含 Unique），
 *   continuous.deck 原语虽已合入，但 programs/statics.ts 的 layerFor 不映射该 kind
 *   （实测 bindStatic 抛 ProgramBindingError），CardProgram.deckbuilding 也无构筑期消费方。
 * - [Equip] 的费用管线缺口：印刷的 [A] 任意域 Power 已能由费用计划的六域
 *   allowedDomains 表达（支付时可选择其中任一域，例如 Order）；已合入的 Equip 展开仍声明
 *   payments: [{ kind: "equip" }]，
 *   而 cost/plan-values.ts 的支付种类仍不含 equip（实测 buildCostPlan 抛 CostPlanError
 *   reason "judge-required"、message "Unsupported payment kind: equip"），启动费用无法在
 *   Finalize 支付。programs/keywords.ts 也未把印刷费用传入 expand 的 params.cost。
 * - 目录原文与 CR 715.4 的 Bonus Damage 描述不一致，需官方勘误/裁定后才能补全能力文本。
 *
 * golden 测试真实执行已合入的 Equip 展开本体（effect.attach 到 Finalize 锁定的你控制的单位），
 * 并对每个 judgeReason 缺口补上直接执行证据（expandProgram 拒绝 unique、binder 无
 * continuous.deck 图层映射、费用管线拒绝 equip 支付种类）；其余缺口写成 test.todo。
 */
const abilities = [
  // 825.1：“[Unique]” 的构筑限制声明；KeywordId 对齐印刷名（小写）。
  { kind: "keyword", keyword: "unique" },
  // 818.1.c.2：费用 1 点 [A]；Universal Power 由费用计划的六域 allowedDomains 表达，
  // costDomain 仍保留为印刷费用的描述性记号。
  { kind: "keyword", keyword: "equip", value: 1, costDomain: "rainbow" }
] as const;

const program = {
  canonicalCardId:
    "card.hash-963c1bf1475a7d2678d6b10353dd2919b09c2bac0c8a471f44fdf8d090a65c02",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "三处当前缺口，均不近似实现：" +
    "（1）数据/规则原文不一致仍待裁定：CR v1.5 715.4 的示例把本卡描述为提供 3 点 Bonus Damage（\"the ability has 3 Bonus Damage from Rabadon’s Deathcrown\"），" +
    "但本地 deck-catalog（sfd-191-221）的 ability 只有 [Unique] 与 [Equip]，没有任何 Bonus Damage 文本；effect.damage 虽已接受 bonus 表达式（712-715 的加总入口），" +
    "但卡面/勘误没有授予来源，也没有\"你的法术与能力获得 +N Bonus Damage\"的持续授予原语，按证据红线不自行补全。" +
    "（2）[Unique] 是 825.1/825.3 的 Deck Constraint Permission（825.4：本体无额外效果）：effects/keywords/registry.generated.ts 注册的 26 个关键词不含 Unique，" +
    "continuous.deck 原语虽已合入但 programs/statics.ts 的 layerFor 没有该 kind 的图层映射（实测 bindStatic 抛 ProgramBindingError \"Static ability kind continuous.deck has no layer mapping\"），" +
    "CardProgram 的 deckbuilding?: DeckbuildingDecision[] 也没有构筑期消费方，卡内自造限制会发明语义。" +
    "（3）[Equip] 的启动费用仍无法在 Finalize 支付：印刷的 [A] 任意域 Power 可由 power payment + 六域 allowedDomains 表达，" +
    "但已合入的 Equip 展开声明 payments: [{ kind: \"equip\", value: { kind: \"source\" } }]，cost/plan-values.ts 的支付种类不含 equip" +
    "（实测 buildCostPlan 抛 CostPlanError reason \"judge-required\"、message \"Unsupported payment kind: equip\"）；" +
    "契约 3.8 第 3 条的 KeywordDef.expand params.cost 虽在接口中，programs/keywords.ts 仍未把印刷费用传入 params.cost。" +
    "golden 只把已合入的 Equip attach 本体当真执行证据。",
  abilities,
  sourceText:
    "[Unique] (Your deck can have only 1 card with this name.)\n" +
    "[Equip] :rb_rune_rainbow: (:rb_rune_rainbow:: Attach this to a unit you control.)"
} satisfies CardProgram;

export default program;

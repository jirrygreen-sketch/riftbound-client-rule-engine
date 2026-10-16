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
 * - [Unique] 无已合入 KeywordDef，也没有 continuous.deck 消费方（effects/keywords/ 注册的
 *   16 个关键词不含 Unique；契约 3.1/3.3 没有构筑期限制的语义位置，只有未定义语义的
 *   deckbuilding?: DeckbuildingDecision[] 形状），卡内自造限制会发明语义。
 * - [Equip] 的 [A] 任意域 Power 在契约层不可表示：契约与内核的 Domain 是六域封闭集合，
 *   effect.resources 明确记录 Universal Power 不可表达、绝不用某个域近似；本卡以描述性
 *   记号 costDomain: "rainbow" 记录印刷费用。
 * - [Equip] 的费用管线缺口：已合入的 Equip 展开声明 payments: [{ kind: "equip" }]，
 *   而 cost/plan-values.ts 的支付种类不含 equip（RIFT-89），启动费用无法在 Finalize 支付。
 * - 目录原文与 CR 715.4 的 Bonus Damage 描述不一致，需官方勘误/裁定后才能补全能力文本。
 *
 * golden 测试真实执行已合入的 Equip 展开本体（effect.attach 到 Finalize 锁定的你控制的单位）；
 * 其余缺口写成 test.todo。
 */
const abilities = [
  // 825.1：“[Unique]” 的构筑限制声明；KeywordId 对齐印刷名（小写）。
  { kind: "keyword", keyword: "unique" },
  // 818.1.c.2：费用 1 点 [A]。六域封闭集合无 Universal 值，costDomain 只作描述性记录。
  { kind: "keyword", keyword: "equip", value: 1, costDomain: "rainbow" }
] as const;

const program = {
  canonicalCardId:
    "card.hash-963c1bf1475a7d2678d6b10353dd2919b09c2bac0c8a471f44fdf8d090a65c02",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "四处缺口/疑点，均不近似实现：" +
    "（1）数据/规则原文不一致——CR v1.5 715.4 的示例把本卡描述为提供 3 点 Bonus Damage（\"the ability has 3 Bonus Damage from Rabadon’s Deathcrown\"，v1.4 4196 同），" +
    "但本地 deck-catalog（sfd-191-221）的 ability 只有 [Unique] 与 [Equip]，没有任何 Bonus Damage 文本；按证据红线不自行补全，需勘误/裁定。" +
    "（2）[Unique] 是 825.1/825.3 的 Deck Constraint Permission（825.4：本体无额外效果），但 effects/keywords/ 注册的 16 个关键词不含 Unique，" +
    "也没有 continuous.deck 消费方；契约 3.1/3.3 没有构筑期限制的语义位置（只有未定义语义的 deckbuilding?: DeckbuildingDecision[] 形状）。" +
    "（3）[Equip] 的印刷费用 :rb_rune_rainbow: 是 135.2.e.5/163.2.b 的 [A] 任意域（Universal）Power，" +
    "而契约与内核的 Domain 是 Fury/Calm/Mind/Body/Chaos/Order 六域封闭集合，effect.resources 明确记录 Universal Power 不可表达、绝不近似成某个具体域；" +
    "本卡以描述性记号 costDomain: \"rainbow\" 记录印刷费用。（4）已合入的 Equip 展开声明 payments: [{ kind: \"equip\" }]，" +
    "而 cost/plan-values.ts 的支付种类不含 equip，该启动费用目前无法在 Finalize 支付（RIFT-89）。" +
    "依赖：官方勘误/裁定、关键词展开工作流（kw-unique，continuous.deck）、RIFT-89（费用支付种类）；[A] 属契约级缺口。" +
    "golden 只把已合入的 Equip attach 本体当真执行证据。",
  abilities,
  sourceText:
    "[Unique] (Your deck can have only 1 card with this name.)\n" +
    "[Equip] :rb_rune_rainbow: (:rb_rune_rainbow:: Attach this to a unit you control.)"
} satisfies CardProgram;

export default program;

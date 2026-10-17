import type { CardProgram } from "../../ir/index.js";

/**
 * Forgefire Cape (sfd-190-221) — Gear, 4 Energy + 2 Power, Might 3
 * (Calm/Mind), tags Ornn / Equipment / Signature.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, sfd-190-221，逐字）:
 *   [Unique] (Your deck can have only 1 card with this name.)
 *   [Equip] :rb_rune_rainbow: (:rb_rune_rainbow:: Attach this to a unit you control.)
 *
 * 规则依据（CR v1.5）：
 * - 825.1/825.2/825.3：[Unique] 是 Deck Constraint Permission，只在构筑期限制
 *   「同名牌每副牌组只能有 1 张」，在本体游戏过程中没有额外效果（825.4）。
 * - 818.1/818.1.b/818.1.b.1/818.1.c.2：[Equip] 是启动式能力关键词，功能等价于
 *   「[费用]：把此装备附着到你控制的一个单位」，选择的单位是 Target（契约 3.6）。
 *   印刷费用是 1 点 :rb_rune_rainbow:，即 135.2.e.5/163.2.b 的任意域（Universal）Power [A]。
 * - 括号里的两句都是提醒文字（135.2.d.1），不是另一条能力。
 *
 * status = judge-required（README 第 2 节；三处当前缺口都不近似实现）：
 * - [Unique] 没有已合入的 KeywordDef，也没有构筑期限制的消费方：effects/keywords/
 *   注册的 25 个关键词不含 Unique，契约 3.1 的 CardProgram 与契约 3.3 的原语集合也没有
 *   构筑期限制的语义位置（只有 deckbuilding?: DeckbuildingDecision[] 这一未定义形状），
 *   卡内自造一套构筑限制会发明语义。
 * - [Equip] 的启动费用无法在 Finalize 支付：已合入的 Equip 展开声明
 *   payments: [{ kind: "equip", value: { kind: "source" } }]，但 cost/plan-values.ts
 *   仍把 equip 支付识别为 judge-required，缺少从装备身份读取原始 Equip CostSpec 的绑定。
 * - [A] 任意域 Power 在契约层不可表示：契约与内核的 Domain 是六域封闭集合
 *   （Fury/Calm/Mind/Body/Chaos/Order），effect.resources 明确记录 163.2.b 的 Universal
 *   Power 不可表达、绝不用某个域近似；本卡以描述性记号 costDomain: "rainbow" 记录印刷费用。
 *
 * golden 测试真实执行已合入的 Equip 展开本体（effect.attach 到 Finalize 锁定的
 * 你控制的单位），依赖缺口写成 test.todo；不据此宣称整卡可执行。
 */
const abilities = [
  // 825.1：“[Unique]” 的构筑限制声明；KeywordId 对齐印刷名（小写）。
  { kind: "keyword", keyword: "unique" },
  // 818.1.c.2：费用 1 点 [A]。六域封闭集合无 Universal 值，costDomain 只作描述性记录。
  { kind: "keyword", keyword: "equip", value: 1, costDomain: "rainbow" }
] as const;

const program = {
  canonicalCardId:
    "card.hash-f57b9ca8014fe44251722063cac371908fc07829fc257206b3c21b2c62f38d89",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "三处当前缺口，均不近似实现：" +
    "（1）[Unique] 是 825.1/825.3 的 Deck Constraint Permission（同名每副牌组 1 张，825.4 说明本体内无额外效果），" +
    "但 effects/keywords/ 注册的 25 个关键词不含 Unique，也没有构筑期限制的消费方；契约 3.1/3.3 没有该语义位置" +
    "（只有未定义语义的 deckbuilding?: DeckbuildingDecision[] 形状），卡内自造限制会发明语义。" +
    "（2）[Equip] 的印刷费用 :rb_rune_rainbow: 是 135.2.e.5/163.2.b 的 [A] 任意域（Universal）Power，" +
    "但契约与内核的 Domain 是 Fury/Calm/Mind/Body/Chaos/Order 六域封闭集合，effect.resources 明确记录 Universal Power 不可表达、" +
    "绝不近似成某个具体域；本卡以描述性记号 costDomain: \"rainbow\" 记录印刷费用。" +
    "（3）已合入的 Equip 展开声明 payments: [{ kind: \"equip\", value: { kind: \"source\" } }]，" +
    "而 cost/plan-values.ts 对 equip payment 仍返回 judge-required，缺少从装备身份读取原始 Equip CostSpec 的绑定。" +
    "依赖：Unique 关键词与构筑约束消费方、装备身份到 Equip CostSpec 的绑定；[A] 属契约级缺口。" +
    "golden 只把已合入的 Equip attach 本体当真执行证据。",
  abilities,
  sourceText:
    "[Unique] (Your deck can have only 1 card with this name.)\n" +
    "[Equip] :rb_rune_rainbow: (:rb_rune_rainbow:: Attach this to a unit you control.)"
} satisfies CardProgram;

export default program;

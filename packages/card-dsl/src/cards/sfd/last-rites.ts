/**
 * Last Rites (sfd-150-221) — Gear, 3 energy, Might 2, Chaos, tag Equipment.
 *
 * sourceText（逐字取自 packages/card-data/data/deck-catalog.json sfd-150-221）：
 *   "[Equip] — :rb_rune_chaos:, Recycle 2 cards from your trash
 *    (Pay the cost: Attach this to a unit you control.)"
 *
 * 规则依据（CR v1.5）：
 * - 818.1 / 818.1.a：Equip 是启动式能力关键词，出现在带 Equipment 标签的 Gear 上；
 *   818.1.b / 818.1.b.1 / 818.1.b.2：支付费用后把此卡附着到所选单位，该选择是 Target，
 *   附着完成后该单位成为 Top-Most Card。
 * - 818.1.c / 818.1.c.1 / 818.1.c.2：格式为 "Equip [费用]"；本卡印的是
 *   "[Equip] — :rb_rune_chaos:, Recycle 2 cards from your trash"，即费用同时包含
 *   1 点 Chaos Power（135.2.e.4）与一项非资源费用"从你的 trash 回收 2 张牌"。
 * - 417.3 / 417.6："Recycle 2 from your trash" 作为费用必须能完成才可支付；417.6 明确
 *   "Recycle X from [Zone]" 由被指示的玩家自行选择、这些牌不是目标（355.7 的 pick 语义）。
 * - 括号内 "Pay the cost: Attach this to a unit you control." 是提示文本（135.2.d.3 无
 *   游戏功能），原文逐字保留，程序不为提示文本生成能力。
 * - 印刷的 3 energy 是 Gear 的打出费用（150.4），不是 Equip 费用。
 *
 * 结构说明（不近似实现）：
 * - abilities[0] 声明 Equip 关键词：value 记印刷的 Power 数量 1，costDomain 记
 *   "Chaos"（与同目录已合入 sfd 装备程序同一约定）。
 * - 非资源费用"Recycle 2 cards from your trash"没有可用的印刷字段：契约 3.1 的
 *   KeywordAbility 只有 { keyword, value }，契约 3.8 第 3 条要求的 expand params.cost
 *   尚未落到 KeywordDef 接口。这里以扩展字段 costAdditions 记录该印刷费用供审查——
 *   它是描述性数据，不是可执行原语调用，也不改共享契约。
 *
 * status = judge-required（复核 2026-10-16）：
 * - 已合入的 Equip 展开（RIFT-87）声明 payments: [{ kind: "equip", value: source }]，
 *   但 cost/plan-values.ts 的 readCost 仍没有 "equip" 支付种类（golden 证明
 *   buildCostPlan 对该 payments 形状抛 Unsupported payment kind: equip，属仍在进行的
 *   RIFT-261 费用种类批次），因此连 1 点 Chaos Power 这一半都无法计算/支付，更无法承载
 *   818.1.c.3 的非资源费用部分；卡牌程序→关键词展开→时点/链的接线（契约 3.5）也仍缺
 *   （RIFT-257 的 expandProgram 可解析声明，但 Equip 展开的 cost 参数没有 KeywordDef
 *   承载字段，见下条）。
 * - 契约 3.8 第 3 条要求 expand 用 params.cost 承载印刷装备费，已合入的 KeywordDef
 *   接口仍无该参数（印刷费用以扩展字段 costAdditions 记录供审查）。
 * - 已合入的费用管线本身支持 recycle 非标准费用（cost/plan-values.ts 的
 *   "recycle" 支付种类），golden 用该印刷声明的具体引用真实收取过一次，证明缺的是
 *   关键词侧的承载字段与 Equip 费用支付，而不是回收费用本身。
 * 与同目录已合入装备程序（long-sword / bf-sword / warmogs-armor / dorans-blade / sacred-shears）
 * 一致：关键词上的 costDomain（以及本卡的 costAdditions）是扩展字段，因此本文件按这些文件的写法用
 * as const 声明，由 golden 的 validateCardProgram 做结构校验（不是用类型断言绕过契约）。
 */
export default {
  canonicalCardId: "card.hash-a94953e6e26ed3d9751a4dd5e4674a587232a894999224e5ce566be1f0895d89",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "印刷的 [Equip] 费用无法表达也无法支付：(1) 费用同时含 1 点 Chaos Power（818.1.c.2、135.2.e.4）" +
    "与「Recycle 2 cards from your trash」（818.1.c.3 允许的非资源费用），而契约 3.1 的 KeywordAbility " +
    "只有 { keyword, value }，契约 3.8 第 3 条要求 expand 用 params.cost 承载印刷装备费，已合入的 " +
    "KeywordDef 接口仍无该参数（印刷费用以扩展字段 costAdditions 记录供审查）；(2) 已合入的 Equip 展开" +
    "（RIFT-87）声明 payments: [{ kind: \"equip\", value: source }]，cost/plan-values.ts 的 readCost " +
    "没有 \"equip\" 支付种类，费用计划对该形状抛 Unsupported payment kind（RIFT-261 费用种类批次），无法构建；" +
    "(3) 缺卡牌程序→关键词展开→时点/链的接线（契约 3.5；RIFT-257 的 expandProgram 可解析声明，但等 KeywordDef 承载 cost）。" +
    "费用管线本身支持 recycle 非标准费用（cost/plan-values.ts），golden 用印刷声明的具体引用真实收取过一次；" +
    "不改共享契约、不近似实现。依赖：RIFT-261（cost 种类与 KeywordDef params.cost）与关键词接线。",
  abilities: [
    {
      kind: "keyword",
      keyword: "equip",
      // 818.1.c.2：印刷的 Power 部分是 1 点 Chaos Power；value 记数量、costDomain 记领域。
      value: 1,
      costDomain: "Chaos",
      // 818.1.c.3 / 417.6：印刷的非资源费用（"Recycle 2 cards from your trash"）。
      // 描述性声明，不是可执行原语；见 judgeReason。
      costAdditions: [
        { kind: "recycle", amount: 2, zone: "trash", owner: "controller" }
      ]
    }
  ],
  sourceText:
    "[Equip] — :rb_rune_chaos:, Recycle 2 cards from your trash (Pay the cost: Attach this to a unit you control.)"
} as const;

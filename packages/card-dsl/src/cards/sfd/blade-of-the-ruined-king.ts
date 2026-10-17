/**
 * Blade of the Ruined King (sfd-178-221) — Gear, 3 energy, 1 Order power, Might 4,
 * Order, tag Equipment.
 *
 * sourceText（逐字取自 packages/card-data/data/deck-catalog.json sfd-178-221）：
 *   "[Equip] — :rb_rune_order:, Kill a friendly unit
 *    (Pay the cost: Attach this to a unit you control.)"
 *
 * 规则依据（CR v1.5）：
 * - 818.1 / 818.1.a：Equip 是启动式能力关键词，出现在带 Equipment 标签的 Gear 上；
 *   818.1.b / 818.1.b.1 / 818.1.b.2：支付费用后把此卡附着到所选单位，该选择是 Target。
 * - 818.1.c：格式为 "Equip [费用]"；818.1.c.3 明确 Equip 费用可以同时包含资源费与
 *   非资源费。本卡的费用是 1 点 Order Power（135.2.e.4）+「Kill a friendly unit」。
 * - 355.10.c / 355.10.c.1：「Kill a friendly unit」紧随费用位（"Pay the cost" 提示文本），
 *   是费用内的 [do X]，不产生目标；对象由支付费用的玩家在支付时自行选择，因此是 pick
 *   语义而非 TargetSpec（代价消灭不触发"成为目标"）。
 * - 429 / 429.2.a / 429.6：Kill 是永久物从 Board 进入 Trash；费用侧消灭由
 *   cost/plan-values.ts 的 "kill" 非标准费用承担（费用计划里是动作，不是效果指令）。
 * - 括号内 "Pay the cost: Attach this to a unit you control." 是提示文本（135.2.d.3 无游戏
 *   功能），原文逐字保留，程序不为提示文本生成能力。
 * - 印刷的 3 energy 是 Gear 的打出费用（150.4），不是 Equip 费用。
 *
 * status = judge-required（复核 2026-10-17）：
 * - Equip 展开只声明 payments: [{ kind: "equip", value: source }]，
 *   cost/plan-values.ts 的 readCost 对该种类直接抛出 "Unsupported payment kind: equip"；
 *   1 点 Order Power 和 Kill 费用因此还不能进入可支付的 Equip 计划。
 * - 契约 3.8 第 3 条的 KeywordDef.params.cost 接口已经存在，但 programs/keywords.ts
 *   只传 value/host，Equip.expand() 也没有读取 params.cost；本卡的 costDomain/costAdditions
 *   仍是审查用扩展字段，不能改变展开费用。
 * - 「Kill a friendly unit」费用本身在已合入的费用管线里可支付（cost/plan-values.ts 的
 *   "kill" 非标准费用 + cost/payment.ts 的 checkAction），golden 用印刷声明的具体引用
 *   真实收取过一次，证明缺的是关键词侧的承载字段与 Equip 费用支付。
 * - activated ability 的生产绑定已存在，但在上述 Equip 费用和参数传递缺口消除前，
 *   ProgramRegistry 会按 judge-required 状态拒绝本卡，无法进入真实 activation Finalize。
 * 与同目录已合入装备程序（long-sword / bf-sword / warmogs-armor / dorans-blade / sacred-shears）
 * 一致：关键词上的 costDomain（以及本卡的 costAdditions）是扩展字段，因此本文件按这些文件的写法用
 * as const 声明，由 golden 的 validateCardProgram 做结构校验（不是用类型断言绕过契约）。
 */
export default {
  canonicalCardId: "card.hash-f9c6d6052ec4552cfcfc53a0e584e07cb232189ed89b277126630202cc188050",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "印刷的 [Equip] 费用仍有两处当前缺口，均不近似实现：(1) Equip.expand() 生成的 " +
    "payments: [{ kind: \"equip\", value: source }] 在 cost/plan-values.ts 的 readCost 中被明确拒绝，" +
    "实测错误为 Unsupported payment kind: equip；因此 1 点 Order Power（818.1.c.2、135.2.e.4）" +
    "与 Kill a friendly unit（818.1.c.3）还不能组成可支付的 Equip 计划。" +
    "(2) 虽然 KeywordDef.params.cost 已在 keyword-contract.ts 声明，programs/keywords.ts 只向 " +
    "expand 传 value/host，Equip.expand() 也不消费该参数；本卡的 costDomain/costAdditions 只能保留" +
    "印刷审计信息，不能进入 activated ability 的费用。已合入并由 golden 真实执行的部分是 " +
    "Kill 费用：cost/plan-values.ts 的 kill 种类和 cost/payment.ts 的 checkAction 会真实消灭所选友方单位，" +
    "且该费用选择是 355.10.c.1 的非目标 pick。ProgramRegistry/activation 绑定会在上述缺口存在时按 " +
    "judge-required 拒绝整卡；不把裸 effect.attach 当成 Equip 完成。",
  abilities: [
    {
      kind: "keyword",
      keyword: "equip",
      // 818.1.c.2：印刷的 Power 部分是 1 点 Order Power。
      value: 1,
      costDomain: "Order",
      // 818.1.c.3：「Kill a friendly unit」是印刷的非资源费用（费用内的 [do X]，355.10.c.1）。
      // 描述性声明，不是可执行原语调用；见 judgeReason。
      costAdditions: [
        { kind: "kill", target: "friendly-unit", selection: "pick" }
      ]
    }
  ],
  sourceText:
    "[Equip] — :rb_rune_order:, Kill a friendly unit (Pay the cost: Attach this to a unit you control.)"
} as const;

import type { CardProgram } from "../../ir/index.js";

/**
 * Temporal Portal (sfd-078-221) — Gear, 3 energy, power null（无印刷 Power）, 领域 Mind, 标签为空。
 *
 * sourceText（逐字取自 packages/card-data/data/deck-catalog.json sfd-078-221）：
 *   ":rb_rune_rainbow:, :rb_exhaust:: Give the next spell you play this turn [Repeat]
 *    equal to its cost. (You may pay the additional cost to repeat the spell's effect.)"
 *
 * 规则依据（CR v1.5）：
 * - 151 / 151.2：Gear 的启动式能力，在控制者的 Main Phase 执行；377.1 说明印刷文本里
 *   “:” 之前的部分是费用。
 * - 404.1.a / 415.4 / 415.5：印刷的 :rb_exhaust: 是启动费用「横置自身」，必须能完成；
 *   :rb_rune_rainbow: 是任意域 Power [A]（135.2.e.5 / 135.2.e.5.a / 163.2.b），作为费用时可由
 *   任意域的 Power 支付。
 * - 820.1 / 820.1.a / 820.1.b / 820.1.c：Repeat 是可选附加费用关键词，出现在法术与能力上；
 *   820.1.c 规定印刷格式为 “Repeat [Cost]”，费用来自卡牌自身的印刷文本。
 * - 本节效果给「你本回合打出的下一个法术」授予一个 Repeat 实例，其费用等于该法术的费用
 *   （“equal to its cost”，按 206 取该牌的印刷费用）；这是对**下一次**法术打出的一次性
 *   （one-shot）授予，随本回合结束失效。
 *
 * status = judge-required（当前缺口均不近似实现）：
 * 1. 已合入的 continuous.grant-keyword 支持 target/pick/choose/objects/filter 选择器与
 *    appliesTo:"self"，但选择器只在激活结算时对当前世界求值；「本回合下一张你打出的法术」
 *    在激活时还不存在，原语没有 one-shot 挂起窗口（例如 card-played 时点的补登记）。
 * 2. Finalize 仍不能把未来法术自己的印刷费用读取为 Repeat 的可选追加费用组件；
 *    `equal-to-its-cost` 只保留为描述性 amount 标记，Repeat 展开仍只携带来源自带的
 *    repeat.cost 实例。
 */
export default {
  canonicalCardId: "card.hash-bb98faffa9506df8c98b1086bec2cbd71a7dd9f4c677d8e31dc335ebfa6e61d5",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "当前缺口：(1) 已合入的 continuous.grant-keyword 支持 target/pick/choose/objects/filter 选择器与" +
    "appliesTo:self，但没有 one-shot 挂起窗口：选择器只在激活结算时对当前世界求值，" +
    "「本回合下一张你打出的法术」那时还不存在，无法把 Repeat 授予“本回合下一张法术”" +
    "的一次性对象窗口；(2) Finalize 尚不能读取未来法术自己的印刷费用并生成可选 Repeat " +
    "追加费用，IR 中的 amount=equal-to-its-cost 目前只有描述性标记、没有消费方；" +
    "本卡的 exhaust 支付和固定关键词授予原语均已合入，不把它们列为缺口。",
  abilities: [
    {
      // 151.2：Gear 启动式能力在控制者 Main Phase 执行；契约 3.1 用 activated.timing 记录。
      kind: "activated",
      cost: {
        kind: "activated",
        // :rb_rune_rainbow: = [A]；用六域 allowedDomains 表达任意域 Power 支付。
        // 415.4/415.5：横置自身作为费用，由费用计划收缴。
        payments: [
          {
            kind: "power",
            amount: { kind: "constant", value: 1 },
            allowedDomains: ["Fury", "Calm", "Mind", "Body", "Chaos", "Order"]
          },
          { kind: "exhaust", object: "self" }
        ]
      },
      timing: "action",
      body: [
        {
          // 820.1.b：给「本回合你打出的下一个法术」授予一个 Repeat 实例，其费用等于该法术的费用。
          // IR 契约没有动态费用消费方；equal-to-its-cost 保留为描述性标记（见 judgeReason）。
          // appliesTo:"next-spell-you-play" 同样是印刷形状的描述性标记：原语只接受
          // appliesTo:"self" 或选择器，且选择器在激活结算时求值，未来的法术那时
          // 还不存在（见 judgeReason 的 one-shot 挂起窗口缺口）。
          id: "temporal-portal.grant-repeat",
          op: "continuous.grant-keyword",
          args: {
            keyword: { kind: "constant", value: "Repeat" },
            amount: { kind: "constant", value: "equal-to-its-cost" },
            appliesTo: { kind: "constant", value: "next-spell-you-play" },
            duration: { kind: "constant", value: "end-of-turn" }
          }
        }
      ]
    }
  ],
  sourceText:
    ":rb_rune_rainbow:, :rb_exhaust:: Give the next spell you play this turn [Repeat] " +
    "equal to its cost. (You may pay the additional cost to repeat the spell's effect.)"
} satisfies CardProgram;

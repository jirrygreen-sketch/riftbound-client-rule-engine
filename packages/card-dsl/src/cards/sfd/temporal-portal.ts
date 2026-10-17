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
 * 1. continuous.grant-keyword 只接受固定 keyword/value 与 self；本卡需要把 Repeat 授予“本回合
 *    下一张法术”，并在该法术 Finalize 时读取它自己的印刷费用，现有参数面没有这种 one-shot
 *    对象窗口或动态费用表达式。
 * 2. 费用计划没有把这次未来法术的印刷费用生成可选追加费用组件；Repeat 自身的展开只描述
 *    来源自带的 repeat.cost 实例。
 * :rb_rune_rainbow: 是 Universal Power，现有六域 Domain 集合仍只能保留描述性 `rainbow`。
 */
export default {
  canonicalCardId: "card.hash-bb98faffa9506df8c98b1086bec2cbd71a7dd9f4c677d8e31dc335ebfa6e61d5",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "当前缺口：(1) continuous.grant-keyword 只接受固定 keyword/value 与 self，无法把 Repeat 授予“本回合下一张法术”" +
    "的一次性对象窗口；(2) Finalize 尚不能读取未来法术自己的印刷费用并生成可选追加费用，故 amount=equal-to-its-cost " +
    "没有消费方；(3) :rb_rune_rainbow: 是 Universal Power，六域 Domain 集合只能保留描述性 [\"rainbow\"]。" +
    "本卡的 exhaust 支付和固定关键词授予原语均已合入，不把它们列为缺口。",
  abilities: [
    {
      // 151.2：Gear 启动式能力在控制者 Main Phase 执行；契约 3.1 用 activated.timing 记录。
      kind: "activated",
      cost: {
        kind: "activated",
        // :rb_rune_rainbow: = [A]；六域封闭集合下没有可执行值，保留描述性记号（无消费方）。
        power: { kind: "constant", value: ["rainbow"] },
        // 415.4/415.5：横置自身作为费用，由费用计划收缴。
        payments: [{ kind: "exhaust", object: "self" }]
      },
      timing: "action",
      body: [
        {
          // 820.1.b：给「本回合你打出的下一个法术」授予一个 Repeat 实例，其费用等于该法术的费用。
          // 消费者是关键词授予 / 一次性费用修正管线，当前没有已注册原语（见 judgeReason）。
          id: "temporal-portal.grant-repeat",
          op: "continuous.grant-keyword",
          args: {
            keyword: { kind: "constant", value: "Repeat" },
            // 820.1.c 的费用来自该法术自己的印刷文本，而不是一个固定数值。
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

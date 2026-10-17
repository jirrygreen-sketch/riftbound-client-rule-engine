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
 * status = judge-required（2026-10-17 RIFT-662 复核，逐条实测，均不近似实现）：
 * 1. 印刷的授予形状在合并原语边界就被拒绝：continuous.grant-keyword 的 argsSchema
 *    不接受 amount（实测 TypeError: Invalid continuous.grant-keyword argument: amount），
 *    且 appliesTo 只接受 "self"。IR 里 amount="equal-to-its-cost"、
 *    appliesTo="next-spell-you-play" 是印刷语义的描述性标记，这条 body 目前无法执行。
 * 2. 即使忽略形状问题，「本回合你打出的下一个法术」在激活结算时还不存在：ObjectSelector
 *    只有 self/source/target/pick/linked，ObjectFilter 没有「尚未打出」量词，TargetSpec
 *    必须锁定 Finalize 时已存在的对象（355.5），Duration 词表也没有 one-shot next-spell
 *    窗口（同 ogn/raging-firebrand、unl/the-academy、rad/firelights-hideout 的记录）。
 * 3. Finalize 仍没有消费方把未来法术自己的印刷费用（206）读成可选 Repeat 追加费用组件
 *    （820.1.c.1）；Repeat KeywordDef 的展开只携带来源自带的 repeat.cost 实例。
 *
 * 已支持且由模板测试真实执行的部分：印刷费用（135.2.e.5.a 的任意域 1 Power +
 * 415.5 的 Exhaust 自身）经合并费用管线完整支付；执行证据见
 * test/cards/templates/activated-activated-continuous-grant-key-662.test.mjs。
 */
export default {
  canonicalCardId: "card.hash-bb98faffa9506df8c98b1086bec2cbd71a7dd9f4c677d8e31dc335ebfa6e61d5",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口（2026-10-17 实测，均不近似实现）：(1) 印刷的 continuous.grant-keyword 形状在合并原语边界被拒绝——" +
    "argsSchema 不接受 amount（实测 TypeError: Invalid continuous.grant-keyword argument: amount），" +
    "appliesTo 也只接受 self，amount=equal-to-its-cost 与 appliesTo=next-spell-you-play 仅作为描述性标记保留；" +
    "(2)「本回合你打出的下一个法术」在激活结算时还不存在：ObjectSelector（self/source/target/pick/linked）" +
    "与 ObjectFilter 没有 one-shot next-spell 窗口，TargetSpec 必须锁定 Finalize 时已存在的对象（355.5），" +
    "Duration 词表也没有对应期限（同 ogn/raging-firebrand、unl/the-academy、rad/firelights-hideout）；" +
    "(3) Finalize 没有消费方读取未来法术自己的印刷费用（206）来构建可选 Repeat 追加费用（820.1.c.1）。" +
    "已支持且经模板测试真实执行：印刷费用（135.2.e.5.a 任意域 1 Power + 415.5 Exhaust 自身）由合并费用管线完整支付。",
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
            // IR 契约没有动态费用消费方；equal-to-its-cost 保留为描述性标记。该标记与
            // appliesTo:"next-spell-you-play" 一起在合并原语边界被拒绝（见 judgeReason）。
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

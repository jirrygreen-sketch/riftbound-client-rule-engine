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
 * status = judge-required（三处缺口，均不近似实现）：
 * 1. 授予路径没有已注册原语：effects/keywords/Repeat.ts 的展开只是「该来源自带一个
 *    repeat.cost 静态效果」，没有「把 Repeat 实例授予未来某个法术」的指令原语或持续效果
 *    消费方；effects/instructions 里没有 continuous.grant-keyword（同型缺口见 ogn 的
 *    Bounty Hunter / sfd 的 Gem Jammer）。
 * 2. “the next spell you play this turn” 的一次性窗口没有落地：Duration 只有 permanent /
 *    end-of-turn / end-of-combat / while-source-in-zone / until，没有 one-shot 的
 *    “下一张法术”期限，也没有把该授予绑定到本回合下一次 Finalize 的费用修正管线
 *    （对照 ogn 的 Raging Firebrand 同源判断，RIFT-89 后续）。
 * 3. “equal to its cost” 需要在该法术 Finalize 时读取它自己的印刷费用（206：一律用印刷
 *    或复制来的费用）并生成一个金额等于该费用的可选附加费用组件；契约的数值表达式没有
 *    「未来被打出对象的印刷费用」这一读数，费用计划也只能由调用方在 Finalize 传入。
 * 此外 :rb_rune_rainbow: 是任意域 Power（163.2.b 的 Universal Power），六域封闭 Domain
 * 集合无法表达，本卡以描述性 ["rainbow"] 记录（同 Matriarch of War / Gravity Field 的处理）。
 * 依赖：RIFT-89（费用计划与一次性费用修正）、RIFT-91（layers-continuous 的授予消费方）、
 * 关键词授予原语。不近似为常驻 Repeat 或固定数值。
 */
export default {
  canonicalCardId: "card.hash-bb98faffa9506df8c98b1086bec2cbd71a7dd9f4c677d8e31dc335ebfa6e61d5",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口：(1) 没有把 Repeat 实例授予未来法术的已注册原语——Repeat 的展开（effects/keywords/Repeat.ts）只声明" +
    "「该来源自带一个 repeat.cost 静态效果」，effects/instructions 没有 continuous.grant-keyword 及 Repeat 授予的消费方" +
    "（同型缺口见 Bounty Hunter / Gem Jammer，RIFT-91）；(2)「the next spell you play this turn」的一次性窗口没有落地——" +
    "Duration 只有 permanent / end-of-turn / end-of-combat / while-source-in-zone / until，没有 next-spell 的 one-shot 期限，" +
    "也没有把该授予绑定到本回合下一次 Finalize 的费用修正管线（同 Raging Firebrand，RIFT-89 后续）；" +
    "(3)「equal to its cost」需要在该法术 Finalize 时读取它自己的印刷费用（206）并生成金额等于该费用的可选附加费用组件，" +
    "现有表达式没有「未来被打出对象的印刷费用」读数，费用计划也只能由调用方在 Finalize 传入。此外 :rb_rune_rainbow: 是" +
    "任意域 Power [A]（135.2.e.5.a / 163.2.b），六域封闭 Domain 集合无法表达，仅以描述性 [\"rainbow\"] 记录。" +
    "依赖：RIFT-89（费用计划与一次性费用修正）、RIFT-91（layers-continuous 授予消费方）与关键词授予原语。不近似实现。",
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

import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Reckless Innovator (rad-105-167) — Unit, 3 Energy, Might 3, Chaos.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, rad-105-167，逐字）：
 *   "[Accelerate] (You may pay :rb_energy_1::rb_rune_chaos: as an additional
 *    cost to have me enter ready.)
 *    When I become exhausted, choose one —
 *    Play a Gold gear token exhausted. (It has \"[Reaction][>] Kill this,
 *    :rb_exhaust:: [Add] :rb_rune_rainbow:.\")Pay :rb_rune_chaos: to draw 1."
 *
 * 规则依据（CR v1.5）：
 * - 805：Accelerate 是可选附加费用关键词（805.1.b 固定 [1][C] 费用，805.1.b.1
 *   按单位域付费，805.6 付费后的延迟替代效果把横置入场改写为就绪入场）。卡牌只
 *   声明关键字（契约 3.1 / README 第 5 节），展开归 effects/keywords/Accelerate.ts。
 * - 383.4.e 之外的“When I become exhausted”：415.1 / 415.1.b 的横置状态变化，
 *   对应封闭时点 object-exhausted（events/timing-points.ts，ruleRefs 415.1）。
 * - “choose one —” 是结算时的模式选择（355.3 的 bulleted list；契约 3.9 的
 *   choice.mode，count=1、different=true）。
 * - 187.5：Gold gear token 是域无关装备 token，自带 "[Reaction][>] Kill this,
 *   [E]: [Add] [A]." 的能力。
 * - 440.2.c / 185.2.a / 350.2：被“打出”的新 token 先在链上生成，再由 play 动作
 *   接手；143.4 / 185.2.d：token 横置入场是入场状态规定，不是事后补一次横置。
 * - “Pay :rb_rune_chaos: to draw 1”：成本内指令（355.10.c.1 的 [do X] to [do Y]），
 *   draw 只有在该支付完成后才发生，故 draw 用 linkedTo 依赖支付指令（同
 *   sfd/sunken-temple 的 pay → draw 结构）。
 *
 * status = judge-required（README 第 2 节）。四处缺口，均不近似实现：
 * 1. Accelerate 展开的消费方未合入：static accelerate.cost 需要 cost.additional /
 *    cost.pay 与 replacement.enter 管线（RIFT-86 / RIFT-89）；支付后才挂上替代
 *    （805.2.b）属打出流程。
 * 2. Gold gear token 定义不在已冻结的 effect.token 定义表内（effect.token.ts 头注
 *    释明确“Definitions requiring other abilities, including Gold, remain
 *    blocked/judge-required”），原语只会返回 blockedReason
 *    token-definition-or-abilities-judge-required。
 * 3. “exhausted” 是入场状态改写（143.4 / 185.2.d），create-token 动作与 effect.token
 *    都不支持入场替代；先创建再补横置会多出一次“成为横置”事件，不等价。
 * 4. cost.pay 原语未合入（effects/instructions/ 无 cost.pay 文件，只有 RIFT-9 清单
 *    与费用计划模块），模式二的混沌符文支付没有已注册执行路径。
 * 依赖：RIFT-86（kw-repeat-accelerate）、RIFT-89（batch3-cost-plan）、
 * RIFT-62/RIFT-63（token 与链上生成）。
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "accelerate" },
  {
    kind: "triggered",
    trigger: { at: "object-exhausted", filter: { self: true } },
    // “choose one —” 是强制选择，不打印“you may”，故不是 mandatory/optional 的
    // 可选触发；可选性只体现在 choice.mode 的两个模式里。
    optional: false,
    body: [
      {
        id: "reckless-innovator.choose-one",
        op: "choice.mode",
        args: {
          count: { kind: "constant", value: 1 },
          different: { kind: "constant", value: true },
          modes: {
            kind: "constant",
            value: [
              {
                id: "reckless-innovator.gold-mode",
                body: [
                  {
                    id: "reckless-innovator.play-gold",
                    op: "effect.token",
                    args: {
                      token: { kind: "constant", value: "gold" },
                      amount: { kind: "constant", value: 1 },
                      // 440.2.c / 185.2.a：新 token 的“打出”先在链上生成。
                      mode: { kind: "constant", value: "play" },
                      // 187.5 的 Gold 是无 Deploy 的装备 token，按普通装备规则打到
                      // 控制者基地（349 / 355.2）；“controller” 由费用/打出管线解析。
                      locations: {
                        kind: "constant",
                        value: [{ type: "base", player: "controller" }]
                      },
                      choiceId: { kind: "constant", value: "gold-token-location" },
                      // 143.4 / 185.2.d 的入场横置改写；effect.token 当前不接受该
                      // 参数（见 judgeReason 第 3 点），保留印刷语义供审查。
                      entersExhausted: { kind: "constant", value: true },
                      linkKey: { kind: "constant", value: "goldToken" }
                    }
                  }
                ]
              },
              {
                id: "reckless-innovator.pay-mode",
                body: [
                  {
                    // 355.10.c.1：成本内指令的支付部分；混沌符文（Power）支付。
                    id: "reckless-innovator.pay-chaos",
                    op: "cost.pay",
                    args: {
                      power: { kind: "constant", value: ["Chaos"] }
                    }
                  },
                  {
                    id: "reckless-innovator.draw-one",
                    op: "effect.draw",
                    linkedTo: "reckless-innovator.pay-chaos",
                    args: { amount: { kind: "constant", value: 1 } }
                  }
                ]
              }
            ]
          }
        }
      }
    ]
  }
];

export default {
  canonicalCardId: "card.hash-f5202df7168d19f18b45036939808e43056853194542d133c56127959e1b69c1",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "四处缺口，均不近似实现：(1) Accelerate 的展开消费方未合入——static accelerate.cost 需要 " +
    "cost.additional / cost.pay 与 replacement.enter 管线（805.2.b 的延迟替代；RIFT-86 / RIFT-89）；" +
    "(2) Gold gear token 定义（187.5，自带 [Reaction][>] Kill this, [E]: [Add] [A] 能力）不在已冻结的 " +
    "effect.token 定义表内（该表按设计只含无额外能力的 token），原语返回 blockedReason " +
    "token-definition-or-abilities-judge-required；" +
    "(3) “exhausted” 是 token 入场状态改写（143.4 / 185.2.d），create-token 动作与 effect.token 都不支持入场替代，" +
    "先创建再补横置会多出一次“成为横置”事件，不等价；" +
    "(4) “Pay :rb_rune_chaos: to draw 1” 的 cost.pay 原语未合入（effects/instructions/ 无该 op）。" +
    "依赖：RIFT-86（kw-repeat-accelerate）、RIFT-89（batch3-cost-plan）、RIFT-62/RIFT-63（token 与链上生成）。",
  abilities,
  sourceText:
    "[Accelerate] (You may pay :rb_energy_1::rb_rune_chaos: as an additional cost to have me enter ready.)\n" +
    "When I become exhausted, choose one —\n" +
    "Play a Gold gear token exhausted. (It has \"[Reaction][>] Kill this, :rb_exhaust:: [Add] :rb_rune_rainbow:.\")" +
    "Pay :rb_rune_chaos: to draw 1."
} satisfies CardProgram;

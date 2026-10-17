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
 * status = judge-required（README 第 2 节，2026-10-17 复核）。当前缺口，均不近似实现：
 * 1. Accelerate 的 KeywordDef 已合入（RIFT-266 系列 / Accelerate.ts），但它的
 *    accelerate.cost 静态声明没有生产消费方：卡牌侧的 keyword 能力不会展开成
 *    Finalize 的 optionalAdditional 条目（chain/engine.ts 的 cost input 只来自
 *    调用方与印刷 CostSpec），支付后才挂上替代（805.2.b）同样属于该打出流程接线。
 * 2. Gold gear token 定义仍不在 effect.token 的 DEFINITIONS 表内（该表只有
 *    recruit/sand-soldier/mech/reflection/tentacle；187.5 的 Gold 自带能力，按原语
 *    文件说明保持 blocked/judge-required），mode "play" 返回 negated +
 *    blockedReason token-definition-or-abilities-judge-required。
 * 3. “exhausted” 是入场状态改写（143.4 / 185.2.d），create-token 动作与 effect.token
 *    都不支持入场状态；先创建再补横置会多出一次“成为横置”事件，不等价。
 * 4. 模式二的 “Pay :rb_rune_chaos: to draw 1” 是指令内费用（355.10.c.1）：费用计划模块
 *    已能支付 power，但没有指令内 cost.pay 原语（effects/instructions/ 仍无该 op；
 *    RIFT-261 进行中），模式二没有可执行路径。
 * 依赖：RIFT-261（费用种类与 cost.pay）、RIFT-120（卡牌 keyword/费用接线）、
 * RIFT-62/RIFT-63（token 定义与链上生成）。
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
    "四处缺口（2026-10-17 复核，均不近似实现）：(1) Accelerate 的 KeywordDef 已合入，但其 " +
    "accelerate.cost 静态声明没有生产消费方——卡牌 keyword 不会展开成 Finalize 的 optionalAdditional 条目，" +
    "805.2.b 的延迟入场替代也未接线（RIFT-120）。(2) Gold gear token 定义（187.5，自带 " +
    "\"[Reaction][>] Kill this, [E]: [Add] [A]\" 能力）仍不在 effect.token 的 DEFINITIONS 表内，" +
    "mode \"play\" 返回 negated 与 blockedReason token-definition-or-abilities-judge-required。" +
    "(3) “exhausted” 是 token 入场状态改写（143.4 / 185.2.d），create-token 与 effect.token 都不支持入场状态，" +
    "先创建再补横置会多出一次“成为横置”事件，不等价。(4) “Pay :rb_rune_chaos: to draw 1” 是指令内费用" +
    "（355.10.c.1），effects/instructions/ 仍无 cost.pay 类原语（RIFT-261 进行中）。" +
    "依赖：RIFT-261（费用种类与 cost.pay）、RIFT-120、RIFT-62/RIFT-63（token 与链上生成）。",
  abilities,
  sourceText:
    "[Accelerate] (You may pay :rb_energy_1::rb_rune_chaos: as an additional cost to have me enter ready.)\n" +
    "When I become exhausted, choose one —\n" +
    "Play a Gold gear token exhausted. (It has \"[Reaction][>] Kill this, :rb_exhaust:: [Add] :rb_rune_rainbow:.\")" +
    "Pay :rb_rune_chaos: to draw 1."
} satisfies CardProgram;

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
 * 2026-10-18 再复核：整卡仍为 judge-required；当前缺口见 judgeReason。
 * 已合入原语与关键词声明不等于生产链路可执行；局部执行证据见同名单卡测试。
 * 本轮把 Accelerate 的费用缺口写成两条实测结果：programs/statics.ts 的 layerFor
 * 对 accelerate.cost 报 “no layer mapping”，programs/play.ts 的 translateCost 对
 * kind "additional-cost" 报 “Additional costs are not bound”；两条都在 Finalize 之前失败。
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
                    // cost.pay 的主参数是 payments（power 只是修饰选项），无印刷
                    // 能量时 energy 显式为 0。
                    id: "reckless-innovator.pay-chaos",
                    op: "cost.pay",
                    args: {
                      payments: {
                        kind: "constant",
                        value: { energy: 0, power: ["Chaos"] }
                      }
                    }
                  },
                  {
                    id: "reckless-innovator.draw-one",
                    op: "effect.draw",
                    linkedTo: "reckless-innovator.pay-chaos",
                    args: {
                      amount: {
                        kind: "constant",
                        value: { kind: "constant", value: 1 }
                      }
                    }
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
    "四项当前真实缺口（2026-10-18 实测）：" +
    "(1) Accelerate 的 KeywordDef 已合入，但两条费用通路都断在 Finalize 之前：programs/statics.ts 的 " +
    "layerFor 对展开的 accelerate.cost 抛 “Static ability kind accelerate.cost has no layer mapping”；" +
    "programs/play.ts 的 translateCost 先拒绝展开里的 optional 字段（“Unsupported play cost field optional”），" +
    "去掉该字段后又以 “Additional costs are not bound” 拒绝 kind \"additional-cost\"（356.2、805.2.b）；" +
    "Finalize 的 optionalAdditional 选择/支付因此拿不到本卡的 accelerate.cost。" +
    "仅付费后才启用的入场替代（805.6）也随之不可达。" +
    "(2) Gold gear token（187.5，带自身 \"[Reaction][>] Kill this, [E]: [Add] [A]\"）不在 effect.token 的冻结定义表：" +
    "对 \"gold\" 执行返回 negated(impossible, token-definition-or-abilities-judge-required)，" +
    "TokenSpec 也没有承载 token 自带能力的字段。" +
    "(3) 印刷的 \"exhausted\" 入场状态（143.4、185.2.d）没有入口：effect.token 的 argsSchema 拒绝 " +
    "entersExhausted（实测 “Invalid effect.token argument: entersExhausted”），创建后再 effect.exhaust 是另一个动作，不能代替入场状态。" +
    "(4) cost.pay 与 effect.draw 都已真实执行（成功支付 Chaos→draw、缺 Power 时抛 CostPlanError 并回滚），" +
    "但 " + "\"Pay X to draw 1\" 仍缺 success-gated payment body/savepoint（355.10.c.1、203.3）：" +
    "现只有 linkedTo 依赖，不构成「支付成功才抽」的语义。" +
    "此外 choice.mode 的解释器可执行，生产 chain Finalize 仍缺 Finalize/Resolve choice-plan adapter。以上任一缺口都阻止整卡 executable。",
  abilities,
  sourceText:
    "[Accelerate] (You may pay :rb_energy_1::rb_rune_chaos: as an additional cost to have me enter ready.)\n" +
    "When I become exhausted, choose one —\n" +
    "Play a Gold gear token exhausted. (It has \"[Reaction][>] Kill this, :rb_exhaust:: [Add] :rb_rune_rainbow:.\")" +
    "Pay :rb_rune_chaos: to draw 1."
} satisfies CardProgram;

import type { CardProgram } from "../../ir/index.js";

/**
 * Curtain Call (unl-182-219) — Spell, 4 energy, no printed power, Fury/Mind,
 * tags Jhin / Signature.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-182-219，逐字；
 * 第 2 行之后的四个模式在本地数据里没有换行，逐字保留）：
 *   "[Repeat] — :rb_energy_1: / :rb_rune_rainbow: / :rb_energy_1::rb_rune_rainbow:
 *    (You may pay each additional cost to repeat this spell's effect.)
 *    Choose one you haven't already chosen —
 *    Draw 1.Deal 2 to a unit at a battlefield.Deal 3 to a unit at a base.
 *    Give a unit at a battlefield -4 :rb_might: this turn."
 *
 * 规则依据（CR v1.5）：
 * - [Repeat]（820.1 / 820.1.a / 820.1.c）是可选附加费用关键词，出现在法术上；
 *   820.1.c.2 / 820.1.c.3 规定每个印刷的 Repeat 费用各自独立、各只能支付一次，
 *   820.1.d / 820.1.d.1 规定支付后结算时把该链项的指令额外执行一次。印刷文本给出
 *   三档费用（1 / rainbow / 1+rainbow），即三个可分别支付的 Repeat 实例。
 * - "Choose one you haven't already chosen —"（355.3）：法术的模式选择在 Finalize
 *   做出；"you haven't already chosen" 让每次额外执行都必须换一个尚未选过的模式。
 * - 四个模式各自是独立效果；"Draw 1" / "Deal 2" / "Deal 3" 用已合入的
 *   effect.draw（414.1）与 effect.damage（418.1）；"a unit at a battlefield" /
 *   "a unit at a base" 是目标合法性限制（355.9.a.1、355.10.b 的示例），单位是目标，
 *   地点不是目标。
 * - "Give a unit at a battlefield -4 :rb_might: this turn" 是本回合的临时 Might 修正，
 *   按 479.4（Arithmetic 图层）由 layers/ 消费。
 *
 * status = judge-required（不近似实现）：
 * 1. Repeat 的附加费用没有接线：keywords/Repeat.ts 自述 cost.additional / cost.pay 与
 *    "结算端把已付费 Repeat 实例数接到解释器 repeat 指令" 的打出管线均未合入（依赖
 *    RIFT-86 / RIFT-89），因此三档印刷费用与"额外执行一次"都无法执行。
 * 2. "you haven't already chosen" 需要跨次结算的"本法术已选模式"记忆；合并的
 *    choice.mode `different: true` 只在同一次选择请求内去重（interpreter/choice.ts），
 *    没有每次结算/每次重复可见的排除集合，也没有 820.2 的"重新做选择"接线。
 * 3. 第 4 个模式的临时 Might 修正没有已合入原语：契约 3.6 的封闭 GameAction 集合没有
 *    might 修改动作，effect.buff 的既有文档明确把临时 Might 归 layers 的
 *    continuous.might（RIFT-83/84）。
 * 4. 结构上的额外阻断：模式的 body 里带 TargetSpec / choice.mode，链的 Finalize 面
 *    （chain/engine.ts assertFinalizationSurface）禁止嵌套目标与模式选择，需要
 *    Finalize/Resolve 的 choice-plan 适配器（RIFT-90 / 引擎批 4）。
 * 依赖：RIFT-86（Repeat 展开与附加费用）、RIFT-89（费用计划）、RIFT-83/84（图层）、
 * RIFT-90（目标/选择计划）。已合入部分：effect.draw 与 effect.damage 的四个模式中
 * 前三个，golden 用真实解释器 + 参考内核执行。
 */

/**
 * 描述性的临时 Might 修正（见 judgeReason 第 3 点）：契约 3.6 的封闭 GameAction
 * 集合没有 might 修改动作，layers/ 的 Arithmetic 图层（479.4）尚未实现消费方，
 * 因此这个 op 不是已注册原语；参数形状沿用 sfd/danger-zone、ogn/stupefy 的写法。
 */
const mightModify = {
  id: "curtain-call.might-modify",
  op: "effect.might-modify",
  args: {
    amount: { kind: "constant", value: -4 },
    duration: { kind: "constant", value: "this-turn" },
    appliesTo: { kind: "constant", value: { type: "unit", location: "battlefield" } }
  }
} as const;

export default {
  canonicalCardId: "card.hash-461012a9889f3812c0033854e007b78f0f8ad1f1d1ef943bf505bfd5defabca6",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处依赖未合入，均不近似实现：(1) [Repeat] 的附加费用与结算端额外执行没有接线：keywords/Repeat.ts 自述 " +
    "cost.additional / cost.pay 与“把已付费 Repeat 实例数接到解释器 repeat 指令”的打出管线未合入（820.1.c.2 / 820.1.d.1，依赖 RIFT-86/RIFT-89），" +
    "印刷的三档费用（1 / rainbow / 1+rainbow）无法支付、效果无法额外执行。" +
    "(2) “Choose one you haven't already chosen” 需要跨次结算的“本法术已选模式”记忆：合并 choice.mode 的 different 只在单次选择请求内去重，" +
    "没有重复执行（820.2 / 820.2.a）可见的排除集合，也没有 750 的重新选择接线。" +
    "(3) “Give a unit at a battlefield -4 :rb_might: this turn” 是临时 Might 修正：契约 3.6 的封闭 GameAction 集合无 might 修改动作，" +
    "effect.buff 既有文档把临时 Might 归 layers 的 continuous.might / 479.4 Arithmetic 图层（RIFT-83/84）。" +
    "另外模式的 body 含 TargetSpec 与 choice.mode，链 Finalize 面（chain/engine.ts assertFinalizationSurface）阻断嵌套目标与模式选择，" +
    "需要 Finalize/Resolve 的 choice-plan 适配器（RIFT-90 / 引擎批 4）。" +
    "Draw 1、Deal 2、Deal 3 三个模式只用已合入的 effect.draw 与 effect.damage，golden 真实执行。",
  abilities: [
    { kind: "keyword", keyword: "repeat" },
    {
      kind: "play",
      // 820.1.c / 820.1.c.2：三个可分别支付的 Repeat 附加费用。KeywordAbility 只有
      // keyword/value（契约 3.1），因此印刷费用按 sfd/danger-zone 的既有写法记录在
      // 打出能力的 cost 上；真正收费与结算端重复执行见 judgeReason 第 1 点。
      cost: {
        kind: "additional-cost",
        keyword: "repeat",
        costs: [
          { energy: { kind: "constant", value: 1 } },
          { power: { kind: "constant", value: ["rainbow"] } },
          {
            energy: { kind: "constant", value: 1 },
            power: { kind: "constant", value: ["rainbow"] }
          }
        ]
      },
      body: [
        {
          // “Choose one you haven't already chosen —” 是 355.3 的模式选择；
          // 跨次去重见 judgeReason 第 2 点，本程序按契约 3.9 的冻结形状书写。
          id: "curtain-call.choose-one",
          op: "choice.mode",
          args: {
            count: { kind: "constant", value: 1 },
            different: { kind: "constant", value: true },
            prompt: { kind: "constant", value: "Choose a mode you haven't already chosen." },
            modes: {
              kind: "constant",
              value: [
                {
                  id: "curtain-call-draw-1",
                  body: [
                    {
                      id: "curtain-call.draw",
                      op: "effect.draw",
                      args: { amount: { kind: "constant", value: 1 } }
                    }
                  ]
                },
                {
                  id: "curtain-call-deal-2",
                  body: [
                    {
                      id: "curtain-call.deal-2",
                      op: "effect.damage",
                      args: {
                        amount: { kind: "constant", value: 2 },
                        target: { kind: "constant", value: "curtain-call.battlefield-unit" }
                      },
                      targets: [
                        {
                          id: "curtain-call.battlefield-unit",
                          // “at a battlefield” 是针对单位的合法性限制（355.9.a.1、
                          // 355.10.b 的示例：单位是目标、地点不是）。
                          filter: { type: "unit", location: "battlefield" },
                          min: 1,
                          max: 1,
                          selection: "one"
                        }
                      ]
                    }
                  ]
                },
                {
                  id: "curtain-call-deal-3",
                  body: [
                    {
                      id: "curtain-call.deal-3",
                      op: "effect.damage",
                      args: {
                        amount: { kind: "constant", value: 3 },
                        target: { kind: "constant", value: "curtain-call.base-unit" }
                      },
                      targets: [
                        {
                          id: "curtain-call.base-unit",
                          filter: { type: "unit", location: "base" },
                          min: 1,
                          max: 1,
                          selection: "one"
                        }
                      ]
                    }
                  ]
                },
                { id: "curtain-call-might-minus-4", body: [mightModify] }
              ]
            }
          }
        }
      ]
    }
  ],
  sourceText:
    "[Repeat] — :rb_energy_1: / :rb_rune_rainbow: / :rb_energy_1::rb_rune_rainbow: " +
    "(You may pay each additional cost to repeat this spell's effect.)\n" +
    "Choose one you haven't already chosen —\n" +
    "Draw 1.Deal 2 to a unit at a battlefield.Deal 3 to a unit at a base." +
    "Give a unit at a battlefield -4 :rb_might: this turn."
} satisfies CardProgram;

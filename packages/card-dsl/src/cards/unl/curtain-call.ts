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
 * Status: judge-required. Current source audit:
 * Draw, damage and temporary Might modes execute independently. Repeat
 * instances need Finalize payment/count binding and shared chosen-mode
 * memory; the production chain still rejects choice.mode/nested targets.
 */

/**
 * 第 4 个模式的临时 Might 修正使用已合入的 continuous.might 原语，
 * 由 Arithmetic 图层消费并在 this-turn 到期。
 */
const mightModify = {
  id: "curtain-call.might-modify",
  op: "continuous.might",
  args: {
    objects: { kind: "constant", value: { kind: "target", id: "curtain-call.battlefield-might-unit" } },
    amount: { kind: "constant", value: -4 },
    duration: { kind: "constant", value: "this-turn" }
  },
  targets: [
    {
      id: "curtain-call.battlefield-might-unit",
      filter: { type: "unit", location: "battlefield" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]
} as const;

export default {
  canonicalCardId: "card.hash-461012a9889f3812c0033854e007b78f0f8ad1f1d1ef943bf505bfd5defabca6",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺 Repeat 三档独立附加费用到 Finalize optionalAdditional、支付次数到额外执行次数的绑定（CR 820.1.c.2/820.1.d.1）；keywords/Repeat.ts 的 repeat.cost 尚无消费者。缺本法术跨次执行的已选模式集合：choice.mode different 只在单次请求去重（820.2.a）。programs/play.ts 的 validateSurface 与 chain/engine.ts 的 assertFinalizationSurface 仍阻断 choice.mode/嵌套目标，需 Finalize/Resolve choice-plan 适配；continuous.might 的第 4 模式也受这一目标选择缺口限制。",
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

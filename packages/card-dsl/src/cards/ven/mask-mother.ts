import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Mask Mother (ven-094-166) — Unit, 3 Energy, Might 3, Chaos,
 * tags Spirit/Shadow Isles.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-094-166，逐字）：
 *   When you discard me, you may pay :rb_energy_1: to give a friendly unit
 *   +2 :rb_might: this turn.
 *
 * 规则依据（Core Rules v1.5）：
 * - 423.1.b：“When I am discarded” 与其他弃牌触发在弃牌动作完成后执行；封闭时点
 *   "card-discarded"（events/timing-points.ts，ruleRefs 423.1/423.1.b/423.3/423.4）承载它。
 *   player 用 "self"（触发能力的隐含 "you" 指能力控制者，190.6.d）。
 * - 403.1 / 契约 3.9：“you may pay … to …” 的首段 "you may" 是触发能力的可选执行
 *   （optional = true），被选指令包进 choice.optional 的 body，不写 choice + linkedTo。
 * - 740.4.a：“[do X] to [do Y]” 结构——[do X] = 支付 :rb_energy_1:（费用），
 *   [do Y] = give a friendly unit +2 :rb_might: this turn。740.4.a.2 规定触发能力效果
 *   首段的费用在 Finalization 支付，故费用写成费用计划形状（cost.pay 的 energy，同
 *   sfd/blade-dancer、ven/protective-sands），不是结算时的资源改动。
 * - 355.7 / 355.9.a.1 / 740.1.a：“a friendly unit” 是同一控制者下的单位 → 目标选择
 *   （targets），不是 pick；"friendly" 相对能力控制者。
 * - “+2 :rb_might: this turn” 是带回合期限的临时 Might 修正（143.2.a、479.4.e.1；
 *   到期在 315.4 / 317.2.c 的回合结束清理）。effect.buff 文件头明确临时 Might 归 layers 的
 *   continuous.might，不是 Buff 计数器（702/703）。cost.pay 与 continuous.might
 *   都是已注册的指令原语，golden 覆盖支付成功、支付失败和临时图层注册。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "card-discarded",
      // 423.1.b：本卡被弃置的事件；filter 用契约 3.6 的符号选择器指向能力来源。
      filter: { event: "card-discarded", filter: { source: "self" } }
    },
    optional: true,
    body: [
      {
        id: "mask-mother.may-pay-and-grant",
        op: "choice.optional",
        args: {
          prompt: {
            kind: "constant",
            value: "Pay :rb_energy_1: to give a friendly unit +2 :rb_might: this turn?"
          },
          body: {
            kind: "constant",
            value: [
              {
                id: "mask-mother.pay-energy",
                // 740.4.a.2：触发能力效果首段的费用在 Finalization 支付；
                // cost.pay 接受已求值的 payments 计划。
                op: "cost.pay",
                args: { payments: { kind: "constant", value: { energy: 1 } } }
              },
              {
                id: "mask-mother.give-plus-2-might",
                op: "continuous.might",
                linkedTo: "mask-mother.pay-energy",
                args: {
                  amount: { kind: "constant", value: 2 },
                  duration: { kind: "constant", value: "this-turn" },
                  objects: {
                    kind: "constant",
                    value: { kind: "target", id: "mask-mother.friendly-unit" }
                  }
                },
                targets: [
                  {
                    id: "mask-mother.friendly-unit",
                    // “a friendly unit”：与你（能力控制者）共享控制者的单位（740.1.a）；
                    // 355.9.a.1 的 "unit" 默认指 Board 上的单位。
                    filter: { type: "unit", zone: "board", controller: "self" },
                    min: 1,
                    max: 1,
                    selection: "one"
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
  canonicalCardId: "card.hash-bc75b317e045e4c201028fa2d365ec6ef8a8596d9d4883079758a7044f143bcf",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities,
  sourceText:
    "When you discard me, you may pay :rb_energy_1: to give a friendly unit +2 :rb_might: this turn."
} satisfies CardProgram;

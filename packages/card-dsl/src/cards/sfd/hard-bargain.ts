import type { CardProgram } from "../../ir/index.js";

/**
 * Hard Bargain (sfd-136-221) — Spell, 2 energy, no printed power, Chaos.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, sfd-136-221, verbatim):
 *   "[Reaction] (Play any time, even before spells and abilities resolve.)
 *    [Repeat] :rb_energy_2: (You may pay the additional cost to repeat this
 *    spell's effect.)
 *    Counter a spell unless its controller pays :rb_energy_2:."
 *
 * Rules evidence (Core Rules v1.5):
 * - "[Reaction]" (813.1.b/813.1.c, 159.2.b) is declared only: the keyword
 *   registry expands the Closed-State permission (contract 3.7) and the chain's
 *   canAct decides admission.
 * - "[Repeat] :rb_energy_2:" (820.1.c) is an Optional Additional Cost declared
 *   in the merged sfd/danger-zone / sfd/frigid-touch shape (356.2.b.1) with no
 *   merged collector (RIFT-86/RIFT-89).
 * - "a spell" refers to a finalized object on the Chain (355.9.a.2); Pending
 *   chain items are excluded from target candidates (contract 3.4), so the
 *   targeted spell is a Target locked at Finalize (355.5) and re-verified at
 *   resolution (359.3.e). 355.9.c also keeps this spell from targeting itself.
 * - "unless its controller pays :rb_energy_2:" is a Cost within Instructions
 *   (204.3 / 204.3.a: it appears in a spell and must be paid to get the linked
 *   effect) — the spell's controller is the payer, and the payment gates the
 *   Counter. 426.1/426.1.a/426.2.a then describe what the Counter does (the
 *   countered card does nothing, is cleared from the Chain to the trash, and no
 *   cost is refunded, including additional costs per 426.1.c.1). The two
 *   outcomes are therefore modelled as one mandatory resolution choice
 *   (355.18: undeclared choices are made at resolution) whose chooser is the
 *   targeted spell's controller, with one mode paying and one mode countering.
 *   This is not a "may" for the caster, so it is choice.mode and not
 *   choice.optional (contract 3.9).
 *
 * Status (cards/README.md §2): judge-required. Two merged gaps, neither
 * approximated:
 * - the printed payment has no merged primitive: effects/instructions/ has no
 *   `cost.pay` instruction (the cost module's plan/payment path is called by
 *   Finalize, not by a resolving card body), and the frozen IR has no binding
 *   for the payment receipt that would gate the Counter (356.4.f.1-style
 *   "paid" result). The paying mode is recorded with the pending op so the
 *   reading stays reviewable, and executing it fails closed.
 * - the [Repeat] additional cost has no merged collection/count path
 *   (RIFT-86/RIFT-89).
 * The Counter half itself uses the merged effect.counter and is executed by the
 * golden test (including the chooser identity and the pending-item exclusion).
 */
const hardBargain = {
  canonicalCardId: "card.hash-55adf64cca0264ddf7c18b80652ab54d84af691e7b2866565c41d9b05391ac81",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处依赖未合入，均不近似实现：(1)「unless its controller pays :rb_energy_2:」是 Costs within Instructions" +
    "（CR 204.3 / 204.3.a：出现在法术里、必须支付才能取得被链接的效果），付款者是目标法术的控制者，付款结果要作为" +
    "门控「是否反制」的收据；effects/instructions/ 下没有 cost.pay 指令（费用模块的 plan/payment 由 Finalize 调用，" +
    "不是结算期卡牌正文可用的原语），冻结 IR 也没有 356.4.f.1 型的「已支付」结果绑定，因此付款分支无法执行、反制无法被门控。" +
    "(2)「[Repeat] :rb_energy_2:」的可选追加费用没有收取/计数路径（Repeat 关键词展开 RIFT-86 / 费用计划 RIFT-89；" +
    "冻结的 KeywordAbility IR 不承载印刷费用）。" +
    "反制半段（目标为链上已定案法术、Pending 项不可选、426.1/426.1.a 的移入 Trash）只用已合入的 effect.counter，" +
    "golden 已真实执行并断言 chooser 是目标法术的控制者。依赖：RIFT-89（cost.pay / 支付收据）、RIFT-86。",
  abilities: [
    { kind: "keyword", keyword: "reaction" },
    {
      kind: "play",
      cost: {
        // 印刷基础费用 2 Energy、无 Power 由卡牌身份在 Finalize 绑定（356.1.c）；
        // 这里只声明 [Repeat] :rb_energy_2:（820.1.c）的可选追加费用（无消费方，见 judgeReason）。
        kind: "additional-cost",
        keyword: "repeat",
        energy: { kind: "literal", value: 2 }
      },
      body: [
        {
          id: "hard-bargain.counter-unless-paid",
          op: "choice.mode",
          args: {
            // 355.18：付款与否由目标法术的控制者在结算时决定，不是施法者的" may "。
            chooser: {
              kind: "object-property",
              object: { target: "hard-bargain.spell" },
              property: "controller"
            },
            count: { kind: "constant", value: 1 },
            different: { kind: "constant", value: true },
            prompt: {
              kind: "constant",
              value: "Pay :rb_energy_2: or have this spell countered?"
            },
            modes: {
              kind: "constant",
              value: [
                {
                  id: "hard-bargain.pays",
                  body: [
                    {
                      // Costs within Instructions（204.3），由目标法术的控制者支付：
                      // 该 op 没有已合入实现（见 judgeReason），golden 不声称它可执行。
                      id: "hard-bargain.pay-two-energy",
                      op: "cost.pay",
                      args: { energy: { kind: "constant", value: 2 } }
                    }
                  ]
                },
                {
                  id: "hard-bargain.declines",
                  body: [
                    {
                      // 426.1/426.1.a/426.2.a：反制该法术（目标为链上已定案法术，
                      // 355.9.a.2；Pending 项按契约 3.4 不可成为目标）。
                      id: "hard-bargain.counter",
                      op: "effect.counter",
                      args: {
                        target: { kind: "constant", value: "hard-bargain.spell" }
                      }
                    }
                  ]
                }
              ]
            }
          },
          targets: [
            {
              id: "hard-bargain.spell",
              filter: { type: "spell", zone: "chain" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ],
  sourceText:
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "[Repeat] :rb_energy_2: (You may pay the additional cost to repeat this spell's effect.)\n" +
    "Counter a spell unless its controller pays :rb_energy_2:."
} satisfies CardProgram;

export default hardBargain;

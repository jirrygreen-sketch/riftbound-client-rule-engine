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
 *   in the merged sfd/frigid-touch shape (356.2.b.1) with no merged collector
 *   (RIFT-86/RIFT-261).
 * - "a spell" refers to a finalized object on the Chain (355.9.a.2); Pending
 *   chain items are excluded from target candidates (contract 3.4), so the
 *   targeted spell is a Target locked at Finalize (355.5) and re-verified at
 *   resolution (359.3.e). 355.9.c also keeps this spell from targeting itself.
 * - "unless its controller pays :rb_energy_2:" is a Cost within Instructions
 *   (204.3 / 204.3.a: it appears in a spell and must be paid to get the linked
 *   effect) — the spell's controller is the payer, and the payment gates the
 *   Counter. 426.1/426.1.a/426.2.a then describe what the Counter does. The two
 *   outcomes are therefore modelled as one mandatory resolution choice
 *   (355.18: undeclared choices are made at resolution) whose chooser is the
 *   targeted spell's controller, with one mode paying and one mode countering.
 *   This is not a "may" for the caster, so it is choice.mode and not
 *   choice.optional (contract 3.9).
 *
 * Status (cards/README.md §2, 复核 2026-10-17): judge-required. Two gaps
 * remain, neither approximated:
 * - the printed payment is a Cost within Instructions (204.3 / 204.3.a) whose
 *   payer is the *targeted spell's controller*, not the caster. The merged
 *   cost.pay primitive only accepts { cost, power, nonstandardOrder, payments,
 *   linkKey } and its cost/kinds layer always charges ctx.controller
 *   (cost/payment.ts rejects a plan whose player differs from ctx.controller),
 *   so there is no executable form that charges another player while a card body
 *   resolves. The paying mode is recorded with the printed op/args so the
 *   reading stays reviewable, and executing it charges the caster instead —
 *   which is why it stays judge-required rather than being wired to cost.pay.
 * - the [Repeat] additional cost has no merged collection/count path
 *   (Repeat's KeywordDef expansion is the static repeat.cost kind, which
 *   programs/statics.ts's layerFor() cannot bind: "Static ability kind
 *   repeat.cost has no layer mapping"), and the card-program binding also
 *   rejects the `kind: "additional-cost"` CostSpec outright (programs/play.ts
 *   judgeRequired "Unsupported play cost field keyword").
 *   programs/play.ts's validateSurface additionally refuses the resolving
 *   choice.mode body ("Mode choices require a Finalize/Resolve choice-plan
 *   adapter"), so no production play draft exists for this card yet.
 * The Counter half itself uses the merged effect.counter and is executed by the
 * golden test (including the chooser identity), and the full body runs through
 * the production chain adapter for the declining mode.
 */
const hardBargain = {
  canonicalCardId: "card.hash-55adf64cca0264ddf7c18b80652ab54d84af691e7b2866565c41d9b05391ac81",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处当前缺口，均不近似实现：(1)「unless its controller pays :rb_energy_2:」是 Costs within Instructions" +
    "（CR 204.3 / 204.3.a：出现在法术里、必须支付才能取得被链接的效果），付款者是目标法术的控制者；" +
    "已合入的 cost.pay 只接受 { cost, power, nonstandardOrder, payments, linkKey }，其 cost/payment.ts 明确要求" +
    " plan.player === ctx.controller（否则 invalid-cost-plan），因此没有任何可执行形态能在结算中收取别的玩家，" +
    "该支付分支无法真实执行、反制也因此无法被收据门控（程序保留印刷 op/args 供复核）。" +
    "(2)「[Repeat] :rb_energy_2:」的可选追加费用没有收取/计数路径：Repeat 的 KeywordDef 展开是静态 " +
    "repeat.cost，programs/statics.ts 的 layerFor() 对其抛 \"Static ability kind repeat.cost has no layer mapping\"，" +
    "且卡牌程序绑定直接拒绝该 CostSpec 形状（programs/play.ts 对 additional-cost 的 keyword 字段抛 judge-required）。" +
    "同一条 play 绑定还以 validateSurface 拒绝结算体里的 choice.mode（\"Mode choices require a Finalize/Resolve " +
    "choice-plan adapter\"），因此本卡在生产打出路径上还没有草稿。" +
    "反制半段（目标为链上已定案法术、Pending 项不可选、426.1/426.1.a 的移入 Trash）只用已合入的 effect.counter，" +
    "golden 已真实执行并断言 chooser 是目标法术的控制者；在 production 适配器下 declining 模式真实清链。" +
    "依赖：结算期「由指定玩家支付」的费用收据形态（cost.pay 或等价原语）与 [Repeat] 的收取/计数接线。",
  abilities: [
    { kind: "keyword", keyword: "reaction" },
    {
      kind: "play",
      cost: {
        // 印刷基础费用 2 Energy、无 Power 由卡牌身份在 Finalize 绑定（356.1.c）；
        // 这里只声明 [Repeat] :rb_energy_2:（820.1.c）的可选追加费用（无消费方，且绑定层拒绝该形状）。
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
                      // Costs within Instructions（204.3 / 204.3.a），由目标法术的
                      // 控制者支付。args 用已合入 cost.pay 的 payments 记录形状记录
                      // 印刷的 2 Energy，但该模式不能接进真实结算：cost/payment.ts
                      // 只按 ctx.controller 收费，会把付款者错成施法者（见 judgeReason），
                      // 因此这里保持可复核的记录，不伪造「他人支付」的收据。
                      id: "hard-bargain.pay-two-energy",
                      op: "cost.pay",
                      args: { payments: { kind: "constant", value: { energy: 2 } } }
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

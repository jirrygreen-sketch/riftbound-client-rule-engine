import type { CardProgram } from "../../ir/index.js";

/**
 * Here to Help — sfd-111-221 (Spell, 2 energy + 1 Body power, Body, tags []).
 *
 * Printed text (packages/card-data/data/deck-catalog.json, sfd-111-221, verbatim):
 *   [Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)
 *   [Action] (Play on your turn or in showdowns.)
 *   You may play a unit from hand to a battlefield you control, reducing its cost by :rb_energy_3:.
 *
 * Catalog evidence: energy 2, power 1 (Body), might null, domains ["Body"], tags [].
 *
 * Modeling notes (Core Rules v1.5):
 * - [Hidden] (811) and [Action] (806) are keyword abilities expanded by the
 *   keyword registry (contract 3.7); the card only names them.
 * - "You may play a unit from hand ..." is a permission with an optional
 *   effect ("may"), so the contracted shape is choice.optional wrapping the
 *   instruction it permits (contract 3.9), not a leading choice with a
 *   linkedTo successor.
 * - "a unit from hand" is a non-target pick: 355.10.a excludes non-public
 *   zones (the hand) from targeting, so the unit is read through a PickSpec and
 *   played with the merged effect.play (420.3/420.3.a, a Limited Action).
 * - "to a battlefield you control" is the runtime play destination
 *   (355.2/355.2.a: units are played to the controller's Base or a battlefield
 *   the controller controls). effect.play's location argument is an Expr that
 *   must evaluate to a LocationRef; a runtime Location choice has no merged
 *   selector, so the descriptor below is descriptive and fail-closed (the
 *   primitive negates rather than playing to a wrong location).
 * - "reducing its cost by :rb_energy_3:" is a cost reduction on the played
 *   unit's cost (356.1.c "for [Cost]" rewrites, 356.4 discounts, 356.6 floors
 *   at zero). The merged cost planner consumes discounts from its caller
 *   (cost/plan-types.ts CostDiscount) and effect.play requires an
 *   already-finalized FinalizedCostPlan; no merged producer turns a card
 *   program's cost descriptor into that plan.
 *
 * Status: judge-required. All three dependencies are still missing today and
 * nothing is approximated (no printed-cost play, no invented battlefield id, no
 * unconditional body):
 * - a runtime consumer for the Hide action: cost/kinds/hidden.ts only builds and
 *   pays a Hidden cost plan; the Hide Discretionary Action, the facedown zone and
 *   the free facedown play (811.1.b/811.1.c) stay with their zone/timing owners;
 * - a producer that turns the printed -3 energy reduction into an already
 *   finalized FinalizedCostPlan for effect.play (356.4/356.6);
 * - a runtime Location selector for "a battlefield you control"
 *   (355.4/355.4.a, 451.1) — the in-progress location-choice work RIFT-357.
 */
const hereToHelp = {
  canonicalCardId: "card.hash-783f18a4ad28b8126f59f285304bee0b93c1e76fb7a557f8e9fee60bebf1f609",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处依赖缺口，均不近似实现：(1)[Hidden]（811）的展开已合入（keywords/Hidden.ts），cost.hidden 费用种类的构建与支付也已合入" +
    "（cost/kinds/hidden.ts）；Hide 行动、facedown 区域与从 facedown 免费打出（811.1.b/811.1.c）" +
    "仍没有运行期消费者（见 cost/kinds/README.md 的集成请求）。" +
    "(2)「play a unit from hand」是 effect.play 的非目标 pick（355.10.a：手牌不是公开区域），" +
    "「reducing its cost by :rb_energy_3:」需要按 356.1.c/356.4/356.6 生成已 Finalize 的减费计划，" +
    "而把卡牌程序的费用描述变成已 Finalize 的 FinalizedCostPlan 的生产者不存在，effect.play 明确要求 cost 是费用系统产出的 FinalizedCostPlan。" +
    "(3)「a battlefield you control」是运行期 Location 选择（355.4/355.4.a、451.1；进行中的 RIFT-357），" +
    "合并 IR 没有运行期 Location 选择器，effect.play 的 location 只接受 { type:\"base\",player } 或 { type:\"battlefield\",id }；" +
    "本卡保留描述性目的地标记，解释器会拒绝（negated）而不是落到错误地点。",
  abilities: [
    { kind: "keyword", keyword: "hidden" },
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 2 },
        power: { kind: "constant", value: 1 }
      },
      body: [
        {
          // "You may ..." → contract 3.9: choice.optional wraps the permitted
          // instruction in its body.
          id: "here-to-help.may-play-unit",
          op: "choice.optional",
          args: {
            prompt: {
              kind: "constant",
              value: "Play a unit from hand, reducing its cost by 3 energy?"
            },
            body: {
              kind: "constant",
              value: [
                {
                  id: "here-to-help.play-unit",
                  op: "effect.play",
                  args: {
                    pick: { kind: "constant", value: "here-to-help.unit" },
                    // 描述性目的地标记：运行期 "a battlefield you control"
                    // Location 选择未合入（见 judgeReason 第 3 点）。
                    location: {
                      kind: "constant",
                      value: {
                        kind: "destination-selector",
                        filter: { type: "battlefield", controller: "self" }
                      }
                    },
                    // 描述性减费计划：effect.play 需要已 Finalize 的
                    // FinalizedCostPlan，减费生产者未合入（见 judgeReason 第 2 点）。
                    cost: {
                      kind: "constant",
                      value: {
                        kind: "cost.modify",
                        base: "printed",
                        resource: "energy",
                        amount: -3,
                        minimum: 0,
                        finalized: false
                      }
                    }
                  },
                  picks: [
                    {
                      id: "here-to-help.unit",
                      options: ["dynamic:unit-card-in-controller-hand"],
                      filter: { type: "unit", zone: "hand", owner: "self" },
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
  ],
  sourceText:
    "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
    "[Action] (Play on your turn or in showdowns.)\n" +
    "You may play a unit from hand to a battlefield you control, reducing its cost by :rb_energy_3:."
} satisfies CardProgram;

export default hereToHelp;

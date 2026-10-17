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
 *   must evaluate to a LocationRef. The merged LocationExpr/choose selector is
 *   evaluated by condition.value and linked into effect.play, whose primitive
 *   schema accepts linked-value but not a direct location expression.
 * - "reducing its cost by :rb_energy_3:" is a cost reduction on the played
 *   unit's cost (356.1.c "for [Cost]" rewrites, 356.4 discounts, 356.6 floors
 *   at zero). The merged cost planner consumes discounts from its caller
 *   (cost/plan-types.ts CostDiscount) and effect.play requires an
 *   already-finalized FinalizedCostPlan; no merged producer turns a card
 *   program's cost descriptor into that plan.
 *
 * Current status: judge-required. Hidden's runtime Hide/facedown/free-play
 * consumer and a finalized -3 Energy cost plan for the picked Unit are absent.
 * Location choice is now executable: condition.value captures a LocationExpr
 * and effect.play reads its linked value through the existing primitive schema.
 */
const hereToHelp = {
  canonicalCardId: "card.hash-783f18a4ad28b8126f59f285304bee0b93c1e76fb7a557f8e9fee60bebf1f609",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "[Hidden] 的展开与 cost.hidden 费用构建/支付已合入，但 Hide 行动、facedown 区域和从 facedown 免费打出" +
    "尚未接入运行期（811.1.b/811.1.c）。effect.play 需要所选手牌单位的 FinalizedCostPlan；" +
    "cost.modify 按当前能力来源构建计划，source 分支仅处理 Weaponmaster Equipment，尚无按本卡 pick " +
    "读取单位权威费用、应用 -3 Energy 并接入该单位打出/Finalize 的绑定（356.4/356.6），不能用本法术的费用替代。" +
    "LocationSelector 与运行期 Location 选择已合入，本卡通过 condition.value→linked-value 绑定受控战场；不再将其列为依赖。",
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
                  id: "here-to-help.choose-battlefield",
                  op: "condition.value",
                  args: {
                    value: {
                      kind: "location",
                      value: {
                        kind: "choose",
                        id: "here-to-help.battlefield",
                        filter: { type: "battlefield", controller: "controller" }
                      }
                    }
                  }
                },
                {
                  id: "here-to-help.play-unit",
                  op: "effect.play",
                  args: {
                    pick: { kind: "constant", value: "here-to-help.unit" },
                    // effect.play accepts linked-value Exprs; keep the runtime
                    // Location choice on the interpreter's condition.value node.
                    location: {
                      kind: "linked-value",
                      instructionId: "here-to-help.choose-battlefield",
                      key: "value"
                    },
                    // 描述性减费计划：effect.play 需要已 Finalize 的
                    // FinalizedCostPlan，所选单位的费用绑定未合入（见 judgeReason）。
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

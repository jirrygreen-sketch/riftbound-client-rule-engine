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
 * - "reducing its cost by :rb_energy_3:" is a discount on the played unit's
 *   cost (356.4 discounts, 356.6 floors at zero). Measured 2026-10-18: the
 *   merged cost.modify CAN now freeze that plan for the picked card through an
 *   explicit CostSpec whose energy/power expressions read the card's own
 *   PickSpec selector (base = the unit's printed cost, one -3 Energy discount
 *   instance, plan.finalized true). What is still missing is the handoff:
 *   effect.play consumes a flat FinalizedCostPlan (finalized/energy/power/xp)
 *   and reads `cost.energy ?? 0`, while cost.modify links a full CostPlan whose
 *   payable amount lives under `total`. Handing that locked plan to effect.play
 *   passes the schema check and then pays 0 — a silent free play — and no merged
 *   producer flattens CostPlan.total into the flat descriptor for the played
 *   card (cost/kinds/README.md integration request 5). resolveChainBody's
 *   LITERAL_FIELDS also has no cost.modify entry, so a card body cannot decode
 *   the primitive's literal id/modifier arguments at all.
 *
 * Current status: judge-required (2026-10-18 re-check). Two measured gaps:
 * Hidden's runtime Hide/facedown/free-play consumer, and the locked-plan ->
 * effect.play handoff for the picked unit's -3 Energy cost. Location choice is
 * already executable: condition.value captures a LocationExpr and effect.play
 * reads its linked value through the existing primitive schema, so the golden
 * exercises that path with the card's own instruction. The card keeps the
 * descriptive, non-finalized cost descriptor so effect.play fails closed
 * instead of playing the unit for free.
 */
const hereToHelp = {
  canonicalCardId: "card.hash-783f18a4ad28b8126f59f285304bee0b93c1e76fb7a557f8e9fee60bebf1f609",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处当前缺口（2026-10-18 实测；均不近似实现）：(1) [Hidden] 的展开（静态 cost.hidden）与 cost.hidden 的" +
    "费用构建/支付已合入，但运行期没有 Hide 自由行动、facedown/Champion 区域、次回合 Reaction 许可与从 facedown " +
    "免基础费的打出（811.1.b/811.1.c/811.6）：programs/statics.ts 的 layerFor 对 cost.hidden 直接抛 " +
    "ProgramBindingError(judge-required)「Static ability kind cost.hidden has no layer mapping」，cost/README.md " +
    "集成请求 3 仍记录 zones/actions 缺少这些接口。(2) 所选手牌单位的 -3 Energy 打出：cost.modify 已能用显式 " +
    "CostSpec（object-property 读本卡 PickSpec）取该单位权威印刷费用并冻结 -3 计划（356.4/356.6，基费 4 打出 1、" +
    "下限 0，golden 有执行证据），但 effect.play 只消费扁平 FinalizedCostPlan（finalized/energy/power/xp，读 " +
    "cost.energy ?? 0），而 cost.modify 链接的是可付额在 total 下的完整 CostPlan：把该计划直接交给 effect.play 会通过 " +
    "schema 校验后按 0 Energy 打出（静默免费打出），没有任何已合入生产方把 CostPlan.total 摊平成该描述符并在该单位的 " +
    "Play/Finalize 事务中支付（cost/kinds/README.md 集成请求 5）；同时 chain/interpreter-adapter.ts 的 " +
    "LITERAL_FIELDS 没有 cost.modify，卡内 body 连 id/modifier 字面量都无法解码（实测 TypeError）。" +
    "LocationSelector 与受控战场选择已合入并由 golden 执行，不再列为依赖。",
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

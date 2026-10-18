import type { CardProgram } from "../../ir/index.js";

/**
 * The Harrowing — ogn-198-298 (Spell, Chaos, 6 Energy + 2 Chaos Power).
 *
 * Printed text (packages/card-data/data/deck-catalog.json, ogn-198-298):
 *   Play a unit from your trash, ignoring its Energy cost. (You must still
 *   pay its Power cost.)
 *
 * Modeling notes (Core Rules v1.5):
 * - No [Action]/[Reaction] keyword is printed, so no speed keyword is
 *   declared: normal spell timing is an Open State outside Showdowns on the
 *   controller's turn (155); Action would add Showdown timing (159.2.a.1).
 * - "Play a unit from your trash" is a game-effect Play (420.3, a Limited
 *   Action) and the chosen card is a target: a Trash is a Public zone, so a
 *   unit card in it is targetable (355.10.a, 355.10.a.1). 056.1 keeps the
 *   card in its owner's zone, so the spec pins the controller's own trash.
 * - "Ignoring its Energy cost" is base-cost handling, not an instruction:
 *   356.1.b.2 sets the base Energy cost to zero while the Power cost still
 *   applies, and 356.1.b.3 keeps later additional costs/increases. The merged
 *   cost.modify primitive can already build an ignore-base: energy CostPlan
 *   and preserve additional costs/increases. It needs a caller-supplied
 *   printed projection (or reads ctx.source, which is this spell rather than
 *   the selected unit). effect.play does not derive that projection.
 *
 * Status: judge-required after source review on 2026-10-17. No consumer turns
 * this descriptor into a plan for the selected unit. Adding a cost.modify IR
 * instruction does not close that gap: chain/interpreter-adapter.ts has no
 * literal-argument decoding for it, and its CostPlan.total is not the flat
 * FinalizedCostPlan consumed by effect.play/chain/engine.ts. The latter's
 * pending -> Finalize/Resolve handoff already exists; it is not a missing
 * primitive. Golden tests use cost.modify and prepareCostPayment to produce
 * real overrides for supported subeffects, without declaring this card's
 * selected-object/Finalize integration executable.
 */
const theHarrowing = {
  canonicalCardId: "card.hash-b1f0d3c36b0411806913cc29b12f067b24cd42286481ac3676aa35aa75b6943c",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "复核 2026-10-17：cost.modify/cost.pay、印刷费用绑定、ignore-base: energy 算术及 chain handoff 均已合入。" +
    "仍缺所选 Trash 单位到嵌套 Finalize 的费用适配（CR 356.1.b.2/356.1.b.3、420.3.b.1）：" +
    "① 本卡 cost.modify 描述符没有消费方；cost.modify 需要调用方提供 CostPlanInput.printed，否则读取 ctx.source（本法术），不能动态读取目标单位的印刷费用。" +
    "② chain/interpreter-adapter.ts 未解码 cost.modify 的静态 IR 参数；其输出 CostPlan 的费用在 total，" +
    "而 effect.play 和 chain/engine.ts 消费顶层 energy/power 的 FinalizedCostPlan，不能直接链接，否则会丢失 Power、追加费用与增费。" +
    "需在所选单位的 Finalize 中保留该 ignore-base 改写及后续费用；不手写零费用计划、不近似免费打出。",
  abilities: [
    {
      kind: "play",
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 6 },
        power: { kind: "constant", value: 2 }
      },
      body: [
        {
          id: "the-harrowing.play-unit",
          op: "effect.play",
          args: {
            target: { kind: "constant", value: "the-harrowing.unit" },
            // 356.1.b.2 的费用改写意图（Energy 置 0、Power 照付）；最终必须由费用
            // 系统在 Finalize 生成 FinalizedCostPlan，卡牌不结算费用。
            cost: { kind: "constant", value: { kind: "cost.modify", ignore: "energy" } }
          },
          targets: [
            {
              id: "the-harrowing.unit",
              filter: { types: "unit", zone: "trash", owner: "controller" },
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
    "Play a unit from your trash, ignoring its Energy cost. (You must still pay its Power cost.)"
} satisfies CardProgram;

export default theHarrowing;

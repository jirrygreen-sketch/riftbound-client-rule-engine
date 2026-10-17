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
 *   declared; spells default to Action timing (159.2.a).
 * - "Play a unit from your trash" is a game-effect Play (420.3, a Limited
 *   Action) and the chosen card is a target: a Trash is a Public zone, so a
 *   unit card in it is targetable (355.10.a, 355.10.a.1). 056.1 keeps the
 *   card in its owner's zone, so the spec pins the controller's own trash.
 * - "Ignoring its Energy cost" is base-cost handling, not an instruction:
 *   356.1.b.2 sets the base Energy cost to zero while the Power cost still
 *   applies, and 356.1.b.3 keeps later additional costs/increases. The merged
 *   effect.play primitive only consumes an already-finalized cost plan and
 *   states that it "never derives printed costs or implements an ignored-cost
 *   rule", so the Finalize cost layer (cost/cost-plan.ts, whose
 *   BaseCostModification already models ignore-base: energy) has to build it,
 *   and a consumer must read this card's cost.modify descriptor.
 *
 * Status: judge-required. The cost modification is recorded as a cost.modify
 * descriptor on the play instruction; while it is not a finalized plan the
 * merged primitive reports negated/impossible (contract 3.3). The merged cost
 * pipeline can build the ignore-base plan itself —
 * BaseCostModification { kind: "ignore-base", ignore: "energy" } is implemented
 * in cost/cost-plan.ts — but nothing consumes the card's cost.modify descriptor
 * to produce it. The cost.modify primitive is merged, but no producer reads the
 * selected card's printed cost and passes an ignore-base plan to effect.play.
 * No hand-written FinalizedCostPlan and no approximation by playing
 * the card for free.
 */
const theHarrowing = {
  canonicalCardId: "card.hash-b1f0d3c36b0411806913cc29b12f067b24cd42286481ac3676aa35aa75b6943c",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺「忽略 Energy 费用」的费用计划接线：356.1.b.2 要求把本牌的 Base Energy cost 置 0 而 Power 费用照付——" +
    "已合入的 cost/cost-plan.ts 已实现 BaseCostModification { kind: \"ignore-base\", ignore: \"energy\" }，" +
    "但 ① 没有任何已合入消费方读取卡程序的 cost.modify 描述符并生成本次 Finalize 的费用计划；" +
    "② cost.modify 原语虽然已合入，但它需要调用方提供可计算的 CostPlanInput，当前没有从被选 Trash 单位读取印刷费用并把 ignore-base: energy 接入 effect.play 的生产管线。" +
    "effect.play 只接受已生成的 FinalizedCostPlan（自述 never derives printed costs or implements an ignored-cost rule），" +
    "未 finalized 时按契约 3.3 返回 negated/impossible，不近似实现（不为免费打出、不手写计划）。" +
    "依赖：被选卡印刷费用读取、cost.modify 描述符到 Finalize 计划的消费接线、该计划到 effect.play 的链接，以及 420.3 Limited Action 的 chain handoff。",
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

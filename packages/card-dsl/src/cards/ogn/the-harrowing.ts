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
 *   rule", so the Finalize cost layer (RIFT-89 batch3-cost-plan, whose
 *   BaseCostModification already models ignore-base: energy) has to build it.
 *
 * Status: judge-required. The cost modification is recorded as a cost.modify
 * descriptor on the play instruction; while it is not a finalized plan the
 * merged primitive reports negated/impossible (contract 3.3). No hand-written
 * FinalizedCostPlan and no approximation by playing the card for free.
 */
const theHarrowing = {
  canonicalCardId: "card.hash-b1f0d3c36b0411806913cc29b12f067b24cd42286481ac3676aa35aa75b6943c",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺「忽略 Energy 费用」的 Finalize 费用计划落地：356.1.b.2 要求把本牌的 Base Energy cost 置 0 而" +
    "Power 费用照付，但已合入的 effect.play 只接受已生成的 FinalizedCostPlan（自述 never derives printed " +
    "costs or implements an ignored-cost rule），卡程序是静态数据不能自己推导费用；费用计划的生成与消费属 " +
    "RIFT-89（batch3-cost-plan，BaseCostModification 已含 ignore-base）。当前 IR 以 cost.modify 描述符记录" +
    "356.1.b.2 的意图，未 finalized 时按契约 3.3 返回 negated/impossible，不近似实现。",
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
            // 系统在 Finalize 生成 FinalizedCostPlan（RIFT-89），卡牌不结算费用。
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

import type { CardProgram } from "../../ir/index.js";

/**
 * Eager Apprentice (ogn-084-298) — Unit, 3 energy, 3 Might, Mind, Piltover.
 *
 * Printed text:
 *   While I'm at a battlefield, the Energy costs for spells you play is
 *   reduced by :rb_energy_1:, to a minimum of :rb_energy_1:.
 *
 * Status: judge-required — the discount is described with the contract's
 * continuous cost layer, but no merged consumer can apply it:
 * - the Finalize cost plan applies discounts only when the caller supplies
 *   them (engine-core `cost/cost-plan.ts` reads `CostPlanInput.discounts`),
 *   and no card-program adapter turns this static effect into such a
 *   discount; there is also no registered `cost.modify` instruction opcode;
 * - 356.4.e ("If a discount applies a minimum cost, that minimum applies only
 *   to that discount") and the 356.4.c.1 / 356.4.d ordering of component vs
 *   total discounts are cost-plan responsibilities that only exist for
 *   caller-supplied discounts;
 * - "spells you play" additionally needs the playing-player scope, which
 *   belongs to the layers / cost batches (RIFT-91, RIFT-89).
 * Not approximated: the reduction is kept as data instead of a substituted
 * Energy cost, and `energy: null` on the source card is never treated as 0.
 */
export default {
  canonicalCardId: "card.hash-e5d8b2e1e9ee0d9e2669fae947f4252a33dfc970df9cd39ad8477263b66fccc6",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺少把静态减费效果接进 Finalize 费用计划的消费者：契约 3.6 没有已注册的 cost.modify / cost 原语，" +
    "cost/cost-plan.ts 只在调用方显式提供 CostPlanInput.discounts 时应用折扣（356.4.c.1 / 356.4.d 的组件与总价顺序、" +
    "356.4.e 每条折扣自带最低值），层系统（continuous 成本层）未合入；「spells you play」的玩家范围同理。" +
    "依赖：RIFT-89（cost plan）、RIFT-91（layers-continuous）；不近似实现。",
  abilities: [
    {
      kind: "static",
      effect: {
        kind: "continuous.cost-modification",
        resource: "energy",
        amount: { kind: "constant", value: -1 },
        minimum: { kind: "constant", value: 1 },
        appliesTo: { type: "spell", controller: "controller" }
      },
      condition: {
        kind: "compare",
        left: {
          kind: "count",
          subject: "objects",
          filter: { object: "self", location: "battlefield" }
        },
        operator: "gte",
        right: { kind: "constant", value: 1 }
      }
    }
  ],
  sourceText:
    "While I'm at a battlefield, the Energy costs for spells you play is reduced by :rb_energy_1:, to a minimum of :rb_energy_1:."
} satisfies CardProgram;

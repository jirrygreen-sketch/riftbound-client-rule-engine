import type { CardProgram } from "../../ir/index.js";

/**
 * Spoils of War (ogn-144-298) — Spell, 4 energy + 1 Body power.
 *
 * Printed text:
 *   [Reaction] (Play any time, even before spells and abilities resolve.)
 *   If an enemy unit has died this turn, this costs :rb_energy_2: less.
 *   Draw 2.
 *
 * Modeling notes (Core Rules v1.5):
 * - [Reaction] (813) is declared as a keyword ability; the keyword registry
 *   owns its expansion (contract 3.7).
 * - "This costs [2] less if an enemy unit has died this turn" is a discount on
 *   the Energy component decided during Finalize (355.1 / 355.1.a, 356.4.b,
 *   356.4.d), with 356.4.e (a discount's minimum only limits that discount) and
 *   356.6 (Energy cannot be reduced below 0). It is declared as a static
 *   continuous.cost-modification ability, the shape the merged Finalize cost
 *   collector consumes when its condition is supported. Two current
 *   production consumers are missing (rechecked 2026-10-18), so the card is
 *   judge-required:
 *   - the default CardProgram/Chain Finalize path still calls buildCostPlan
 *     directly and does not collect a card's own static discount into
 *     CostPlanInput.discounts;
 *   - the discount's condition ("an enemy unit has died this turn") uses a
 *     HistoryQuery shape that cost/discounts/values.ts does not evaluate, and
 *     the game-server ResolveContext exposes only a placeholder history
 *     implementation. A relative-opponent death predicate therefore cannot
 *     gate the production discount;
 * - "Draw 2." is a plain effect.draw (414.3) and is independent of the
 *   discount: it resolves whenever the spell resolves.
 */
const spoilsOfWar = {
  canonicalCardId: "card.hash-f1f8b1ffd2a9dcbd2d052a21cda44bb88a2c34a60045e4a5b5059be0dfb97f83",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处当前生产缺口（复核 2026-10-18；355.1/355.1.a、356.4.b/d、356.4.e、356.6）：" +
    "(1) engine-core 已合入 finalizeCostPlan 的静态折扣收集，但默认 CardProgram/Chain Finalize 仍直接调用 buildCostPlan，" +
    "没有把本卡的 continuous.cost-modification static ability 接进 CostPlanInput.discounts；" +
    "(2) 条件「本回合有敌方单位死亡」需要按 objectFilter 和相对 opponent 读取死亡历史，" +
    "cost/discounts/values.ts 的条件求值器与 apps/game-server/src/engine-runtime/host.ts 的 ResolveContext 都没有该生产适配器。" +
    "Draw 2 只用已合入的 effect.draw（414.3），golden 覆盖正常、空牌库与短牌库；不近似实现费用条件。",
  abilities: [
    { kind: "keyword", keyword: "reaction" },
    {
      kind: "static",
      effect: {
        kind: "continuous.cost-modification",
        resource: "energy",
        amount: { kind: "constant", value: -2 },
        minimum: { kind: "constant", value: 0 },
        appliesTo: "self",
        // "If an enemy unit has died this turn": the discount's Finalize-time
        // history predicate, recorded in the contract 3.8 HistoryQuery shape
        // (objectFilter) that the merged ResolveContext does not implement.
        when: {
          kind: "constant",
          value: {
            history: {
              scope: "turn",
              action: "kill",
              objectFilter: { type: "unit", controller: "opponent" }
            }
          }
        }
      }
    },
    {
      kind: "play",
      body: [
        {
          id: "spoils-of-war.draw-two",
          op: "effect.draw",
          args: { amount: { kind: "constant", value: 2 } }
        }
      ]
    }
  ],
  sourceText:
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "If an enemy unit has died this turn, this costs :rb_energy_2: less.\n" +
    "Draw 2."
} satisfies CardProgram;

export default spoilsOfWar;


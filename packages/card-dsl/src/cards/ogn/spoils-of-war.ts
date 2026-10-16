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
 *   continuous.cost-modification ability, the shape the merged cost planner
 *   (RIFT-89 buildCostPlan) takes as an input discount. Two dependencies are
 *   missing, so the card is judge-required:
 *   - nothing reads CardProgram abilities into a cost plan: buildCostPlan's
 *     discounts/baseModifications are caller input, and effects/instructions
 *     has no cost.modify / cost.printed primitive;
 *   - the discount's condition ("an enemy unit has died this turn") needs a
 *     history predicate over death events of enemy units. The frozen
 *     HistoryQuery is { scope, action, timingPoint, player, object } (contract
 *     3.6); the contract 3.8 addendum (objectFilter / exclude) is not in the
 *     merged ResolveContext, and neither Condition nor CostSpec has a
 *     history-condition form (only the resolve-time condition.history
 *     instruction does). The intended query is recorded below for review.
 * - "Draw 2." is a plain effect.draw (414.3) and is independent of the
 *   discount: it resolves whenever the spell resolves.
 */
const spoilsOfWar = {
  canonicalCardId: "card.hash-f1f8b1ffd2a9dcbd2d052a21cda44bb88a2c34a60045e4a5b5059be0dfb97f83",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「If an enemy unit has died this turn, this costs 2 less.」是 Finalize 阶段的基础费用折扣" +
    "（355.1/355.1.a、356.4.b/d、356.4.e、356.6），两条依赖未合入：(1) 已合入的 cost/ 只提供 buildCostPlan 输入" +
    "（discounts / baseModifications），没有任何消费者读取卡牌程序的静态费用改写，effects/instructions 也没有 " +
    "cost.modify / cost.printed 原语；(2) 条件“本回合有敌方单位死亡”需要按对象过滤的死亡事件历史谓词，" +
    "冻结的 HistoryQuery 只有 {scope, action, timingPoint, player, object}（契约 3.6），契约 3.8 增补的 " +
    "objectFilter / exclude 尚未在合并代码实现，Condition 与 CostSpec 也没有历史条件形态（只有结算期 " +
    "condition.history 指令）。Draw 2 部分只用已合入的 effect.draw，可独立执行。" +
    "依赖：RIFT-89 费用计划消费方 + 契约 3.8 历史查询落地。",
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


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
 *   (buildCostPlan) takes as an input discount. Two current consumers are
 *   missing, so the card is judge-required:
 *   - buildCostPlan accepts caller-provided discounts/baseModifications, but
 *     the static binder has no cost-plan consumer for continuous.cost-modification;
 *     no card ability can therefore install this discount at Finalize;
 *   - the discount's condition ("an enemy unit has died this turn") needs a
 *     Finalize-time history predicate over death events of enemy units. The
 *     declared when/history shape has no cost-planner evaluator or relative
 *     opponent filter in the production path;
 * - "Draw 2." is a plain effect.draw (414.3) and is independent of the
 *   discount: it resolves whenever the spell resolves.
 */
const spoilsOfWar = {
  canonicalCardId: "card.hash-f1f8b1ffd2a9dcbd2d052a21cda44bb88a2c34a60045e4a5b5059be0dfb97f83",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "（355.1/355.1.a、356.4.b/d、356.4.e、356.6），两处当前消费缺口：(1) buildCostPlan 只接受调用方" +
    "提供的 discounts / baseModifications，static binder 没有 continuous.cost-modification 的费用计划消费方，" +
    "因此卡牌能力无法在 Finalize 安装该折扣；(2) 条件“本回合有敌方单位死亡”需要按对象过滤、按相对玩家限定的" +
    "死亡事件历史谓词，声明的 when/history 形状没有费用计划求值器，生产路径也没有相对 opponent 的历史过滤适配；" +
    "Draw 2 部分只用已合入的 effect.draw，可独立执行。",
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


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
 *   missing, both measured on 2026-10-17, so the card is judge-required:
 *   - buildCostPlan accepts caller-provided discounts/baseModifications, but
 *     the production static binder has no cost-plan consumer for
 *     continuous.cost-modification: programs/statics.ts layerFor rejects the
 *     kind ("Static ability kind continuous.cost-modification has no layer
 *     mapping"), so no card ability can install this discount at Finalize;
 *   - the discount's condition ("an enemy unit has died this turn") needs a
 *     Finalize-time history predicate over death events of enemy units. The
 *     chain's CostPlanInput has no when/history evaluator, and the server
 *     runtime's ResolveContext is a stub for both halves
 *     (apps/game-server/src/engine-runtime/host.ts: a constant-zero history and
 *     a test that only handles always/never), so a relative-opponent death
 *     predicate cannot gate a production discount;
 * - "Draw 2." is a plain effect.draw (414.3) and is independent of the
 *   discount: it resolves whenever the spell resolves.
 */
const spoilsOfWar = {
  canonicalCardId: "card.hash-f1f8b1ffd2a9dcbd2d052a21cda44bb88a2c34a60045e4a5b5059be0dfb97f83",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处当前消费缺口（复核 2026-10-17，均实测；355.1/355.1.a、356.4.b/d、356.4.e、356.6）：" +
    "(1) buildCostPlan 只接受调用方提供的 discounts / baseModifications，而生产 static binder 没有 " +
    "continuous.cost-modification 的费用计划消费方——programs/statics.ts 的 layerFor 对该 kind 抛 " +
    "「Static ability kind continuous.cost-modification has no layer mapping」（实测），" +
    "因此本卡的静态能力无法在 Finalize 安装该折扣。" +
    "(2) 条件「本回合有敌方单位死亡」需要按对象过滤、按相对玩家限定的死亡事件历史谓词：" +
    "CostPlanInput 没有 when/history 求值器，且服务端运行时的 ResolveContext 两半都是占位实现" +
    "（apps/game-server/src/engine-runtime/host.ts 的 history 恒为 0、test 只处理 always/never），" +
    "无法在 Finalize 用相对 opponent 的历史判定门控折扣。" +
    "Draw 2 部分只用已合入的 effect.draw（414.3），可独立执行，golden 覆盖正常/空牌库/短牌库。",
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


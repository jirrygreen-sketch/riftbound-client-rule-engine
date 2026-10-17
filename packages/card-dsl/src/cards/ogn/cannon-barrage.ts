import type { CardProgram } from "../../ir/index.js";

/**
 * Cannon Barrage (ogn-127-298) — Spell, 2 energy + 1 Body power.
 *
 * Printed text:
 *   [Reaction] (Play any time, even before spells and abilities resolve.)
 *   Deal 2 to all enemy units in combat.
 *
 * Status: judge-required — two gaps, neither approximated:
 * - The affected set is programmatically selected ("all enemy units in
 *   combat"), so it is NOT a target (355.10.d: "Kill all units at battlefields"
 *   does not target anything). Declaring a TargetSpec would wrongly report
 *   became-target events, so the described instruction carries the set as the
 *   `{ kind: "query", filter }` selection shape that `effect.ready` already
 *   uses for its own "all/each" sets (355.10.d.1) instead of declared targets.
 *   The merged `effect.damage` consumes only a Finalize-locked TargetSpec id
 *   and has no set/query form, so this shape does not execute today;
 *   the golden test drives the merged
 *   damage primitive with the card's own amount over the locked set.
 * - ObjectSnapshot already carries combatRole, and the filter vocabulary reads
 *   it through characteristics, but the combat flow does not yet publish
 *   attacker/defender designations when Combat starts. The 740.2.c combat-role
 *   query therefore cannot be evaluated from live game state.
 */
const cannonBarrage = {
  canonicalCardId: "card.hash-e73ab11687356c6a1a4425ed546ea0a9d32acf12452fea98985aa7f9ba011d35",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺 effect.damage 的非目标 query/集合入口（CR 355.10.d/355.10.d.1）；ctx.targets(id) 不能替代不成为目标的群伤集合。" +
    "另缺 CombatFlow 对 ObjectSnapshot.combatRole 的实时发布及与正在战斗的战场关联（740.2.c），" +
    "无法从当前局面得到全部在战斗中的敌方单位；已有 combatRole 字段及 characteristics 过滤不等于生产战斗状态已接通。",
  abilities: [
    { kind: "keyword", keyword: "reaction" },
    {
      kind: "play",
      body: [
        {
          id: "deal-2-in-combat",
          op: "effect.damage",
          args: {
            amount: { kind: "constant", value: 2 },
            // Described set selection (not targets): every enemy unit with a
            // 740.2.c combat designation. The merged effect.damage schema
            // requires a TargetSpec id string, so this query form is pending;
            // see judgeReason. `combat: false` is the printed non-combat Deal.
            target: {
              kind: "constant",
              value: {
                kind: "query",
                filter: {
                  type: "unit",
                  controller: "opponent",
                  characteristics: { combatRole: ["attacker", "defender"] }
                }
              }
            }
          }
        }
      ]
    }
  ],
  sourceText:
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "Deal 2 to all enemy units in combat."
} satisfies CardProgram;

export default cannonBarrage;

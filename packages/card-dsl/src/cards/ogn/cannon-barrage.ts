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
 *   and has no set/query form, so this shape does not execute today (RIFT-9
 *   target.query/target.many set selection); the golden test drives the merged
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
    "集合不是目标：355.10.d（例 “Kill all units at battlefields” 不取目标）规定 “all enemy units in combat” 由特征程序化选出，" +
    "而 effect.damage 只消费 Finalize 锁定的 TargetSpec（context.targets），没有 355.10.d.1 的 query/集合形式" +
    "故不声明 targets、不近似为选择目标（本卡测试用锁定集合真实执行该伤害原语与印刷数额）；" +
    "同时 ObjectSnapshot 已有 combatRole，ObjectFilter 应通过 characteristics 读取它，但 CombatFlow 在 Combat 开始时" +
    "尚未发布 attacker/defender designation，740.2.c 的实时集合仍无法求值。仍缺 effect.damage 的集合形态与战斗角色生产方。",
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

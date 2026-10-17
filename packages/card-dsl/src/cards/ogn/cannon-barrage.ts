import type { CardProgram } from "../../ir/index.js";

/**
 * Cannon Barrage (ogn-127-298) — Spell, 2 energy + 1 Body power.
 *
 * Printed text:
 *   [Reaction] (Play any time, even before spells and abilities resolve.)
 *   Deal 2 to all enemy units in combat.
 *
 * Status: judge-required — two gaps, neither approximated (both measured
 * 2026-10-17 against the merged engine):
 * - The affected set is programmatically selected ("all enemy units in
 *   combat"), so it is NOT a target (355.10.d: "Kill all units at battlefields"
 *   does not target anything). Declaring a TargetSpec would wrongly report
 *   became-target events, so the instruction carries the set as the
 *   `{ kind: "query", filter }` selection shape that `effect.ready` and
 *   `effect.heal` already consume for their own "all/each" sets (355.10.d.1).
 *   The merged `effect.damage` consumes only a Finalize-locked TargetSpec id
 *   (`args.target` must be a string read through `ctx.targets(id)`) and has no
 *   set/query form, so the authored `objects` descriptor has no consumer and
 *   the instruction is rejected before any damage is dealt (measured
 *   2026-10-17: "effect.damage args.target must be a TargetSpec id string").
 * - ObjectSnapshot already carries combatRole, and the filter vocabulary reads
 *   it through characteristics, but the combat flow does not yet publish
 *   attacker/defender designations when Combat starts (combat/flow.ts still
 *   throws TurnCombatBlockedError('combat-start-transaction')), so the 740.2.c
 *   combat-role query cannot be evaluated from live game state.
 */
const cannonBarrage = {
  canonicalCardId: "card.hash-e73ab11687356c6a1a4425ed546ea0a9d32acf12452fea98985aa7f9ba011d35",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺 effect.damage 的非目标集合入口（CR 355.10.d/355.10.d.1）：已合入的 effect.damage 只接受 Finalize 锁定的 TargetSpec id" +
    "（args.target 必须是字符串并经 ctx.targets 读取），没有 effect.ready / effect.heal 那样的 {kind:'query', filter} 非目标集合分支；" +
    "本卡按 355.10.d 把「所有在战斗中的敌方单位」写成 objects 集合描述符，实测该指令在出伤前被原语拒绝" +
    "（“effect.damage args.target must be a TargetSpec id string”）；把该集合写成 TargetSpec 会错误触发成为目标（355.7、754），不近似实现。" +
    "另缺 CombatFlow 对 ObjectSnapshot.combatRole 的实时发布及与正在战斗的战场关联（740.2.c）：combat/flow.ts 的战斗开始仍抛" +
    " TurnCombatBlockedError('combat-start-transaction')，当前局面无法得到全部在战斗中的敌方单位；" +
    "已有 combatRole 契约字段、测试内核赋值及 characteristics 过滤不等于生产战斗状态已接通。" +
    "依赖：effect.damage 的非目标集合形态（与其它“全部/各单位”伤害牌相同的 query 消费缺口）与战斗 designation 发布。",
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
            // 740.2.c combat designation, carried with the same
            // { kind: "query", filter } descriptor shape that effect.ready /
            // effect.heal consume. The merged effect.damage schema requires a
            // TargetSpec id string, so this shape is pending; see judgeReason.
            // `combat` stays absent: the printed Deal is a non-combat action
            // (418.7), not combat damage.
            objects: {
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

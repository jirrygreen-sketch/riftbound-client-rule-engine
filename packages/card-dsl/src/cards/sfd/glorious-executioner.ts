import type { CardProgram } from "../../ir/index.js";

/**
 * Glorious Executioner (sfd-185-221 / sfd-242-221) — Legend, Fury/Chaos, tag Draven.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, sfd-185-221, verbatim):
 *   "When you win a combat, draw 1. (You win if only your units remain after combat.)"
 *
 * Rules evidence (Core Rules v1.5):
 * - 468.3 / 468.3.a: a player has won a combat if they received the attacker or
 *   defender designation and is the only player with units remaining at that
 *   battlefield during the Determine Combat Result step. 468.4 makes resolving
 *   the chain items from that step the next task, which is the window a
 *   "when you win a combat" ability triggers in. The closed timing point for it
 *   is `combat-result` (events/timing-points.ts, ruleRefs 468.3.a-468.4,
 *   payloadFields combatId/battlefieldId/winnerId/loserId/unitResults/noResult).
 * - 414.1 / 414.3: "Draw 1." is the merged effect.draw; the implicit drawer is
 *   the ability's controller (190.6.d).
 * - The reminder text in parentheses only restates 468.3.a and is not a second
 *   ability.
 *
 * Current status: judge-required. CombatFlow still blocks before combat-result;
 * the trigger-event vocabulary has no `combat-result` discriminator and
 * programs/filters.ts refuses the `details` payload field, so the printed
 * controller-relative winnerId cannot be evaluated. Legend Zone and its trigger
 * active-zone binding are also absent. Program trigger registration and the
 * Draw 1 body are already merged.
 */
export default {
  canonicalCardId: "card.hash-fe2db2b592e71d47e736d643538a15fe129a6cb0b7aab53bd27572177b88671b",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "实测 2026-10-17（HEAD 9be41b14）三处当前缺口：(1) combat-result 仍无生产发射路径——combat/flow.ts 在 " +
    "combat-start-transaction / simultaneous-damage-transaction 处阻断，尚未到达 468.3.a–d / 468.4 的 " +
    "Determine Combat Result 步骤；timing-points.ts 声明的 payloadFields（winnerId 等）只是声明，不是生产者。" +
    "(2) 触发无法注册——events/trigger-spec.ts 的 EVENT_PATTERN_TYPES 没有 combat-result" +
    "（实测 validateTriggerSpec 报 invalid-event-type），programs/filters.ts 也拒绝 details 字段" +
    "（实测 registerProgramTriggers 抛 ProgramBindingError: Unsupported filter field details），" +
    "「你赢得战斗」的 winnerId 与能力控制者比较没有可注册拼写。(3) 活动区域绑定缺失——ZoneId 没有 Legend Zone" +
    "（107.4.a–d），programs/triggers.ts 对永久物默认订阅 board，传奇对象无法在传奇区域订阅触发。" +
    "effect.draw 1 本体已可执行（黄金测试覆盖抽 1 与空牌库口径）。依赖：战斗结果原子事务 + 事件词表 + 传奇区域绑定；不近似实现。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "combat-result",
        // The closed payload field for 468.3.a is winnerId; comparing it to the
        // ability's controller has no merged form (see judgeReason), so
        // this is a descriptive, fail-closed record rather than an evaluated
        // predicate.
        filter: { event: "combat-result", details: { winnerId: "self" } }
      },
      // Nothing printed makes this optional; 468.3.a's win is a condition, not a
      // "you may".
      optional: false,
      body: [
        {
          id: "glorious-executioner.draw",
          // 414.1 / 414.3: draw 1 from the controller's Main Deck.
          op: "effect.draw",
          args: { amount: { kind: "constant", value: 1 } }
        }
      ]
    }
  ],
  sourceText:
    "When you win a combat, draw 1. (You win if only your units remain after combat.)"
} satisfies CardProgram;

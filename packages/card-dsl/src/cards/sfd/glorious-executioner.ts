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
 * status (cards/README.md section 2): judge-required. The printed "you win"
 * predicate cannot be evaluated and the trigger cannot fire:
 * 1. No merged module emits the `combat-result` timing point. combat/flow.ts
 *    stops before it: combat start needs the atomic simultaneous wave that is
 *    not implemented (`combat-start-transaction`), and damage needs the
 *    simultaneous commit it refuses (`simultaneous-damage-transaction`). The
 *    only other occurrence of the name is a boundary label inside
 *    duel/engagement-executor-v2.ts, which is not a chain-pipeline emission.
 * 2. The "you win" comparison has no merged spelling. Two gaps meet here:
 *    a. The closed EventPattern discriminator list (events/trigger-spec.ts
 *       EVENT_PATTERN_TYPES) has no `combat-result` member even though the timing
 *       point exists, so the engine's own validateTriggerSpec rejects the
 *       contract-correct spelling below. The golden test locks that rejection as
 *       evidence instead of retreating to a wrong-but-accepted event name — the
 *       same treatment ven/matriarch-of-war.test.mjs gives its own unvocabularied
 *       event spelling.
 *    b. The payload field for 468.3.a is `winnerId`, but EventPattern.details
 *       compares against literal scalars, so it cannot compare that field to the
 *       ability's controller; the one player selector EventPattern does offer
 *       (`player`) matches the emission's acting player, which is not the same
 *       thing as the combat winner. The filter therefore records
 *       `details.winnerId` descriptively: it fails closed ("self" is a literal, so
 *       a combat you lost never matches) and is never treated as an evaluated
 *       predicate.
 * 3. Independently of the two above, nothing registers a CardProgram's
 *    triggered ability as a pipeline TriggerRegistration (contract 3.5), so the
 *    trigger could not be subscribed even with an emitter in place.
 * The body (effect.draw, amount 1) is merged and is executed by the golden test.
 * Dependencies: RIFT-120/combat flow (combat-result emission), a winner
 * predicate for the combat-result payload, and the contract 3.5 trigger
 * registration consumer. Nothing is approximated: the filter is not relaxed to
 * "any combat" and the trigger is not moved to a different timing point.
 */
export default {
  canonicalCardId: "card.hash-fe2db2b592e71d47e736d643538a15fe129a6cb0b7aab53bd27572177b88671b",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口，均不近似实现：(1) 没有已合入模块发出 combat-result 时点——combat/flow.ts 在它之前就阻断" +
    "（战斗开始需要原子同步波，抛 combat-start-transaction；伤害需要同时提交，抛 simultaneous-damage-transaction），" +
    "duel/engagement-executor-v2.ts 里的同名串只是边界标签、不是链管线发射；" +
    "(2) 「you win」的判定没有已合入拼写，这是两处缺口的叠加：(a) 封闭的 EventPattern 判别值表" +
    "（events/trigger-spec.ts 的 EVENT_PATTERN_TYPES）没有 combat-result 成员——尽管该时点存在，" +
    "所以引擎自带的 validateTriggerSpec 会拒绝下方契约正确的拼写；golden 把该拒绝作为证据锁定，" +
    "而不是退回一个「能被接受但错误」的事件名（与 ven/matriarch-of-war.test.mjs 对其未入词表事件的同一处理一致）；" +
    "(b) 468.3.a 的胜负载荷字段是 winnerId，而 EventPattern.details 只与字面标量比较、无法与能力控制者对比；" +
    "EventPattern 唯一的玩家选择符 player 匹配的是事件的行动玩家，与战斗胜者不是同义；" +
    "下方的 filter 以 details.winnerId 作描述性记录（fail-closed：\"self\" 是字面量，输掉的战斗永远不会命中，" +
    "绝不被当作已求值谓词）；(3) 即使有发射方，也没有任何生产方把 CardProgram 的 triggered 能力注册成管线的 " +
    "TriggerRegistration（契约 3.5）。效果本体 effect.draw（数量 1，抽取者为能力控制者 190.6.d）已合入并由 golden 执行。" +
    "依赖：RIFT-120 / combat 流程的 combat-result 发射、胜负载荷谓词、以及契约 3.5 的触发注册消费者；" +
    "不把过滤放宽成「任意战斗」，也不把触发挪到别的时点。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "combat-result",
        // The closed payload field for 468.3.a is winnerId; comparing it to the
        // ability's controller has no merged form (see judgeReason item 2), so
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

import type { CardProgram } from "../../ir/index.js";

/**
 * Mechanical Bandit — CR v1.5 315.2.a.1, 425.1/425.3, 206.1, 414.1.a, 417.1.
 * The Beginning trigger must belong to the controller's turn. The remaining
 * program needs per-player top-of-deck picks, minimum printed Energy across
 * those revealed cards, and the drawn/remainder object bindings. Re-probed
 * 2026-10-17:
 * - effect.reveal's player argument is a single PlayerId; "each-player" is not
 *   a PlayerId, so the declared instruction negates with an empty reveal
 *   (verified: status negated, revealedCount 0) instead of fanning out.
 * - No registered choice.each-player / player-loop primitive exists
 *   (instructionDefinitionsById.has("choice.each-player") === false); RIFT-358's
 *   ordered picks supply one zoneSlice per player only for a concrete PlayerId.
 * - Arithmetic min exists, but nothing reduces a set of revealed cards to the
 *   minimum printed Energy, compares it, or binds the drawn card and the
 *   remainder. Null printed costs must remain null.
 * - The beginning-start event pattern is still outside the closed
 *   EVENT_PATTERN_TYPES set: the translated filter registers a trigger whose
 *   registerTrigger call throws TriggerSpecValidationError (verified).
 */
export default {
  canonicalCardId: "card.hash-fbba24cf4707d7016fafc967822809401157688fd7d9c1ae90a2287ae2a2ea06",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺每名玩家各取 Main Deck 顶牌的有序非目标 picks（CR 425.3）：effect.reveal 的 player 只接受一个玩家，" +
    "each-player 不是 PlayerId，实测该指令 negated 且 revealedCount 0，不能把 each-player 当实际 PlayerId。" +
    "指令注册表也没有 choice.each-player / 玩家循环原语（instructionDefinitionsById.has(\"choice.each-player\") === false）；" +
    "已合入的 RIFT-358 ordered pick 只在给定具体 PlayerId 时锁定一条 zoneSlice，不提供玩家扇出。" +
    "还缺对每名玩家展示结果的遍历/集合绑定、读取并比较最低基础 Energy（206.1，null 不是 0）、把本人展示的那张牌交给 draw it，" +
    "以及给 Recycle the rest 绑定其余对象；arithmetic.min 只做标量运算，不提供这些集合与玩家上下文。" +
    "your Beginning Phase 过滤还需对齐事件契约：programs/filters.ts 会产生 beginning-start 事件模式，但 " +
    "events/trigger-spec.ts 的 EVENT_PATTERN_TYPES 未接受该事件名，pipeline.registerTrigger 实测抛 TriggerSpecValidationError。",
  abilities: [
    {
      // 315.2.a.1：Beginning Phase 开始的时点。"your" 由时点拥有者按回合玩家判断。
      kind: "triggered",
      trigger: { at: "beginning-start", filter: { event: "beginning-start", player: "controller" } },
      optional: false,
      body: [
        {
          // Blocked declaration: per-player ordered picks must supply the deck tops.
          id: "mechanical-bandit.reveal",
          op: "effect.reveal",
          args: {
            player: { kind: "constant", value: "each-player" },
            zone: { kind: "constant", value: "deck" },
            count: { kind: "constant", value: 1 }
          }
        }
      ]
    }
  ],
  sourceText:
    "At the start of your Beginning Phase, each player reveals the top card of their Main Deck. " +
    "If you revealed a card with the lowest Energy cost, draw it. Recycle the rest."
} satisfies CardProgram;

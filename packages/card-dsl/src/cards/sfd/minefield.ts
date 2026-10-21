import type { CardProgram } from "../../ir/index.js";

/**
 * Minefield (sfd-212-221) — Battlefield, Rumble champion precon (rumble-sfd).
 *
 * "When you conquer here, put the top 2 cards of your Main Deck into your trash."
 *
 * CR v1.5 anchors:
 * - 053.3 / 383.4.c / 473.2.a: "here" is this Battlefield; the Conquer Effect
 *   fires at the Battlefield scored by the conquer.
 * - 190.6.a/d: "you" follows the Battlefield's current controller.
 * - 441.1 / 441.4: effect.mill moves Main Deck cards into trash and burns as
 *   many as possible.
 * - 473.2.c: a Score ability cannot trigger more than once per turn for a
 *   player. once: "per-turn" records that printed lifetime; the finalize/Resolve
 *   path currently consumes it once per chain item, so duplicate collection in
 *   one Score wave remains a production gap.
 *
 * Status rationale (re-checked 2026-10-21 at 852ac7be): judge-required. The
 * landed event matcher now binds "here" from the conquer payload and the host
 * source location, and the mill body executes through the real interpreter.
 * The default lifecycle still has three gaps:
 * - programs/lifecycle.ts:439-441 scans only Secret Zone objects when lifecycle
 *   is attached. Minefield is an existing Board object at match setup, so the
 *   shipped attachLifecycle path does not register its trigger.
 * - CombatFlow.establish updates its internal battlefield controller at
 *   combat/flow.ts:393 but leaves the Battlefield ObjectSnapshot.controller
 *   stale. The trigger scanner therefore evaluates player: "self" against the
 *   original creator instead of the current controller required by 190.6.
 * - turn/flow.ts:159-163 emits one conquer event per participating Unit sharing
 *   one Score wave. Without the explicit bootstrap register below a Board
 *   battlefield has no trigger at all; with that register, multi-Unit scores can
 *   create duplicate Pending triggers before per-turn consumption, and Finalize
 *   currently consumes once per chain item. The pipeline's
 *   batchId can group the events, but CardProgram TriggerOnce does not expose a
 *   per-batch scope (ir/types.ts:531 and ir/validation.ts:77).
 */
export default {
  canonicalCardId: "card.hash-0c36f22df8ffa7bed49f59fd138d24b9b0a52a7b8ad4c720afcaa12ec816eee4",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "实测 2026-10-21（HEAD 852ac7be）仍有三个生产缺口：(1) programs/lifecycle.ts:439-441 在 attachLifecycle " +
    "启动时只扫描 Secret Zone，未绑定 setup 时已经位于 Board 的 battlefield，故默认生产装配不会注册 Minefield；" +
    "(2) CombatFlow.establish 只在 combat/flow.ts:393 更新内部战场控制者，未同步 Battlefield ObjectSnapshot.controller；“you”按 " +
    "CR 190.6.a/d 应由当前控制者控制，但触发扫描读到的是创建者 controller，B 真实征服 Minefield 所在战场时不触发；" +
    "(3) turn/flow.ts:159-163 为每个参与单位发出同一 Score wave 的 conquer 事件；CardProgram TriggerOnce 只允许 " +
    "per-turn/per-combat/per-chain/per-game（ir/types.ts:531、ir/validation.ts:77），没有按已有 per-batch 批次标识的可表达作用域，" +
    "且 per-turn 只在 Finalize 按每个 chain item 分别 consume，而非在 Pending 收集时按 Score wave 去重；多单位同次征服会收集" +
    "重复 Pending trigger（后续第二项虽会 frequency-exhausted，但触发频率已错；CR 473.2.c 要求每玩家每回合至多一次）。" +
    "已合入并可执行的部分：events/pipeline-match.ts:89-94 用 conquer details.battlefieldId 与 source.location 判定 here；" +
    "validateTriggerSpec 与 translateTriggerFilter 已接受该过滤器；effect.mill 经真实 TurnFlow/ChainEngine 将控制者牌库顶 " +
    "至多 2 张按序放入 trash。上述缺口均不近似实现，故整卡保持 judge-required。",
  sourceText: "When you conquer here, put the top 2 cards of your Main Deck into your trash.",
  abilities: [
    {
      kind: "triggered",
      // 470/471: "you" 是能力控制者。闭合词表的拼写是 player: "self"
      // （events/trigger-spec.ts 的 PlayerSelector），programs/filters.ts 的
      // normalizePlayer 同样把 self 归一为该能力控制者；"controller" 只是
      // 旧的非契约别名，会被 validateTriggerSpec 拒绝（invalid-player-selector）。
      trigger: {
        at: "conquer",
        filter: { event: "conquered", here: true, player: "self" },
        // 473.2.c: the Score ability cannot trigger more than once per turn.
        once: "per-turn"
      },
      optional: false,
      body: [
        {
          id: "minefield.mill",
          op: "effect.mill",
          args: {
            // The controller is implicit under 190.6.d; effect.mill owns
            // deck-top order and Burn Out (441.4 / 432.x).
            amount: { kind: "constant", value: 2 }
          }
        }
      ]
    }
  ]
} satisfies CardProgram;

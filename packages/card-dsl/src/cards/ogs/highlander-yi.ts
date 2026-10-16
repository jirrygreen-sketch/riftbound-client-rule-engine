import type { CardProgram } from "../../ir/index.js";

/**
 * Highlander, Yi (ogs-020-024) — Spell, 4 energy (Calm/Body), tags
 * Master Yi/Signature.
 *
 * Printed text (this printing, packages/card-data/data/deck-catalog.json):
 *   [Reaction] (Play any time, even before spells and abilities resolve.)
 *   Choose a friendly unit. The next time it dies this turn, recall it
 *   exhausted instead. (Send it to base. This isn't a move.)
 *
 * Modeling notes (Core Rules v1.5):
 * - [Reaction] (813) is declared as a keyword ability; the registry owns the
 *   Closed State / Showdown permission (813.1.b/813.1.c, 159.2.b).
 * - "Choose a friendly unit" is a targeting choice: 355.10.c's own example
 *   states that "Choose a friendly unit. The next time it would die this turn,
 *   return it to your hand instead" targets a friendly unit because the choice
 *   is not part of the replacement effect. The chosen unit is a TargetSpec.
 * - "The next time it dies this turn, ... instead" is a delayed Replacement
 *   Effect over the chosen unit's death (369.1, 370.1.a.1; the replaced event
 *   does not happen), bounded to one occurrence this turn.
 * - "recall it exhausted" is a Recall, not a Move: 457 relocates a permanent to
 *   its Base without being a Move and 458.1 makes it skip Move triggers; 459
 *   allows recalling permanents and 460.1 says a Recall leaves statuses
 *   unaffected, so the printed "exhausted" is an explicit exception that has to
 *   be applied as part of the replaced outcome. "Send it to base" is the
 *   reminder for the Recall itself.
 *
 * Status: judge-required — four merged pieces are missing, and none of them is
 * approximated:
 * - no merged primitive registers a delayed replacement from a card program:
 *   `ResolveContext` only exposes addContinuous / registerDelayedTrigger, the
 *   replacement registration path lives inside the engine (RIFT-120), and
 *   effects/instructions has no replacement.event opcode;
 * - the printed "the next time" one-occurrence window has no representation:
 *   TriggerSpec.once offers per-turn / per-combat / per-chain / per-game only,
 *   and the end-of-turn expiry of the installed replacement is likewise not
 *   wired for card programs;
 * - Recall cannot be performed or approximated: effect.move documents that
 *   mode "recall" is blocked because the frozen move-location action cannot
 *   distinguish a Recall from a Move (457-460), and submitting an ordinary Move
 *   instead would wrongly fire Move triggers (458.1);
 * - the replacement body has no ObjectSelector for the object of the replaced
 *   event, so "it" cannot be bound to the chosen unit inside the replacement
 *   (355.10.c: that referent is not a new target choice).
 * The chosen-unit target and the replacement shape are recorded below for
 * review. Tracked under the engine batch-4 replacement/chain work (RIFT-120),
 * the Recall gap of RIFT-109, and the delayed-trigger/@once scope work of
 * RIFT-9/RIFT-89.
 *
 * Data note (not changed here): docs/plans/survey/data-issues-recheck.md
 * records that the S-ORIGINS printing of Highlander spells this as "...would
 * die this turn, heal it, exhaust it, and recall it instead", while this local
 * printing still reads "dies ... recall it exhausted". This program follows the
 * local sourceText verbatim as required; the difference is reported to the
 * coordinator instead of being silently rewritten.
 */
const highlanderYi = {
  canonicalCardId: "card.hash-65c099c33a6f39283027cbf4532037cbd7fe982a1e896afd5bf5d35e0fc16512",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺延迟替代登记与 Recall：(1) 没有已注册原语消费卡牌程序的替代声明——ResolveContext 只有 " +
    "addContinuous / registerDelayedTrigger，替代注册在引擎内部（RIFT-120 尚未把 CardProgram 的 replaces/with 转成动作匹配器），" +
    "effects/instructions 也没有 replacement.event 原语；(2) 印刷的“the next time”一次性窗口没有表示：" +
    "TriggerSpec.once 只有 per-turn / per-combat / per-chain / per-game，且卡牌程序登记的替代没有回合末到期接线；" +
    "(3) Recall 无法执行也无法近似：effect.move 文档明确 mode \"recall\" 被阻断（封闭 move-location 动作无法区分 Recall 与 Move，CR 457-460），" +
    "用普通移动顶替会错误触发 Move 触发（458.1）并改变状态（460.1 要求 Recall 不影响状态，印刷的 exhausted 是本卡写明的例外）；" +
    "(4) 替代体没有指向“被替代事件对象”的 ObjectSelector，无法把 \"it\" 绑定到所选单位（355.10.c：该指代不是新的目标选择）。" +
    "因此不近似实现；“Choose a friendly unit”本身是目标（355.10.c 示例）并且已按 TargetSpec 编码。" +
    "依赖：RIFT-120（替代注册/延迟触发）、RIFT-109（Recall 动作）、RIFT-89（once 作用域）。",
  abilities: [
    { kind: "keyword", keyword: "reaction" },
    {
      kind: "play",
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 4 }
      },
      body: [
        {
          // "Choose a friendly unit. The next time it dies this turn, recall it
          // exhausted instead." The choice is a target (355.10.c). The
          // replacement registration opcode and the Recall body are not
          // merged (see judgeReason), so the shape is recorded as data only.
          id: "highlander-yi.register-death-replacement",
          op: "replacement.event",
          args: {
            event: { kind: "constant", value: "object-killed" },
            window: { kind: "constant", value: "next-time-this-turn" },
            // "it": the chosen unit. The choice is made when the spell is
            // finalized (355.5/355.10.c), so the body refers to the declared
            // TargetSpec by its selector. There is still no selector for the
            // object of the replaced event itself (see judgeReason), which is
            // why binding the replacement body stays blocked.
            object: { kind: "constant", value: "highlander-yi.chosen-unit" },
            instead: {
              kind: "constant",
              value: [
                {
                  // "recall it ...": a Recall (457), not a Move (458.1).
                  id: "highlander-yi.recall",
                  op: "effect.move",
                  args: {
                    objects: { kind: "constant", value: { target: "highlander-yi.chosen-unit" } },
                    to: { kind: "constant", value: "controller-base" },
                    mode: { kind: "constant", value: "recall" }
                  }
                },
                {
                  // "...exhausted": 460.1's stated exception, applied as part
                  // of the replaced outcome. It names the same chosen unit
                  // (355.10.c: "it" is not a new target choice).
                  id: "highlander-yi.exhaust-recalled",
                  op: "effect.exhaust",
                  args: { target: { kind: "constant", value: "highlander-yi.chosen-unit" } },
                  linkedTo: "highlander-yi.recall"
                }
              ]
            }
          },
          targets: [
            {
              id: "highlander-yi.chosen-unit",
              filter: { type: "unit", controller: "self" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ],
  sourceText:
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "Choose a friendly unit. The next time it dies this turn, recall it exhausted instead. (Send it to base. This isn't a move.)"
} satisfies CardProgram;

export default highlanderYi;

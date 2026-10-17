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
 * Status: judge-required (re-checked 2026-10-17) — `replacement.event` and its
 * next-time-this-turn window plus the `{ linked: "replacement.object" }`
 * replaced-event binding are merged in the replacement binder, but this card's
 * printed shape still cannot execute. Three live gaps:
 * - the play body registers the replacement with a `replacement.event`
 *   *instruction*, and no such opcode exists in the instruction registry: the
 *   merged interpreter rejects the card's own body with "Unregistered
 *   instruction opcode: replacement.event" (the binder consumes that op only
 *   inside a `kind: "replacement"` ability's `with` array, never as a
 *   resolution-time registration); there is also no `trigger.delayed` op that
 *   could express "this turn, the next death";
 * - Recall cannot be performed or approximated: effect.move documents that
 *   mode "recall" is blocked because the frozen move-location action cannot
 *   distinguish a Recall from a Move (457-460); the merged planner fails closed
 *   with BlockedReplacementError for exactly that mode, and submitting an
 *   ordinary Move instead would wrongly fire Move triggers (458.1);
 * - the replacement body's "it" is the previously chosen unit (355.10.c), not
 *   the replaced event's object. The planner resolves `{ linked:
 *   "replacement.object" }` but has no Finalize-locked TargetSpec binding, so
 *   `{ target: "highlander-yi.chosen-unit" }` fails with "Unsupported
 *   object-valued replacement argument" even though the replaced object of this
 *   card's death replacement is that same unit.
 * The chosen-unit target and the replacement shape are recorded below for
 * review; the remaining gaps are the registration opcode, the Recall action and
 * the replaced-object binding.
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
    "替代绑定本身已合入（replacement/bind.ts 支持 replacement.event 的 next-time-this-turn 一次性窗口与 " +
    "{ linked: \"replacement.object\" }），但本卡的印刷能力仍不可执行，三处都是当前缺口：" +
    "(1) 打出体的替代登记指令 op 是 replacement.event，而指令注册表没有该 opcode——" +
    "合并解释器对本卡 body 直接抛 \"Unregistered instruction opcode: replacement.event\"" +
    "（binder 只在 kind \"replacement\" 能力的 with 数组里消费它，没有结算期登记原语，也没有 trigger.delayed）；" +
    "(2) Recall 无法执行也无法近似：effect.move 明确 mode \"recall\" 被阻断（封闭 move-location 动作无法区分 Recall 与 Move，" +
    "CR 457-460），合并 planner 对该 mode 抛 BlockedReplacementError，而用普通移动顶替会错误触发 Move 触发（458.1）并改变状态" +
    "（460.1 要求 Recall 不影响状态，印刷的 exhausted 是本卡写明的例外）；" +
    "(3) 替代体里的 \"it\" 是先前选择的单位（355.10.c：该指代不是新的目标选择），" +
    "planner 能解析 replacement.object 链接，但没有 Finalize 锁定 TargetSpec 的绑定通道，" +
    "{ target: \"highlander-yi.chosen-unit\" } 抛 \"Unsupported object-valued replacement argument\"。" +
    "不近似实现；“Choose a friendly unit”本身是目标（355.10.c 示例）并且已按 TargetSpec 编码。" +
    "依赖：替代登记原语（trigger.delayed 或等价 op）、Recall 独立动作，以及替代体的被选单位绑定。",
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
            event: { kind: "constant", value: { event: "object-killed" } },
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

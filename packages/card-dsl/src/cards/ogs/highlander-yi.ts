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
 * - "The next time it dies this turn, ... instead" is a Delayed Replacement
 *   (391.3) over the chosen unit's death (369.1, 370.1.a.1; the replaced event
 *   does not happen), bounded to one occurrence this turn.
 * - "recall it exhausted" is a Recall, not a Move: 457 relocates a permanent to
 *   its Base without being a Move and 458.1 makes it skip Move triggers; 459
 *   allows recalling permanents and 460.1 says a Recall leaves statuses
 *   unaffected, so the printed "exhausted" is an explicit exception applied as
 *   part of the replaced outcome. "Send it to base" is the reminder for the
 *   Recall itself.
 * - "it" in the replaced outcome is the intercepted object of the death event
 *   (355.10.c). Because the registration is anchored to the chosen unit, that
 *   intercepted object is the chosen unit, so the body spells it with the
 *   merged `{ linked: "replacement.object" }` binding instead of re-declaring
 *   the TargetSpec.
 *
 * Status: judge-required (re-checked 2026-10-17) — RIFT-595 registered
 * `replacement.event` (registry.generated.ts) and its one-shot
 * `next-time-this-turn` window plus the `{ linked: "replacement.object" }`
 * replaced-event binding and the `effect.exhaust` planner mapping all execute
 * on the merged path (goldens below). The card still cannot execute as
 * printed; three live gaps remain:
 * - the declaration cannot be anchored to the chosen unit. `replacement.event`
 *   throws BlockedReplacementError for any `object` argument
 *   ("replacement.event object binding needs a Finalize target adapter; it is
 *   not approximated"), so the chosen TargetSpec cannot become the death
 *   pattern's object anchor. Omitting `object` is not an option: the pattern
 *   would then match the first death of *any* object this turn; the golden
 *   shows the unanchored merged registration also replacing an enemy unit's
 *   death;
 * - the play body's registration still cannot run in the production chain: the
 *   chain interpreter rebuilds its instruction `ResolveContext` and drops the
 *   `replacement`/`replacementDependencies` extension, so even a shape the
 *   merged instruction accepts fails closed with "replacement instruction
 *   requires ResolveContext.replacement dependencies (host + pipeline)" — the
 *   merged seam has no production caller yet (the test kernel and the RIFT-595
 *   harness inject it by hand);
 * - Recall cannot be performed or approximated: effect.move documents that
 *   mode "recall" is blocked because the frozen move-location action cannot
 *   distinguish a Recall from a Move (457-460); the merged planner fails closed
 *   with BlockedReplacementError for exactly that mode (CR 457-460), and
 *   submitting an ordinary Move instead would wrongly fire Move triggers
 *   (458.1) and change state (460.1). No `effect.recall` instruction and no
 *   recall GameAction exist in the closed vocabulary.
 * The chosen-unit target and the replacement shape are recorded below for
 * review; the remaining gaps are the Finalize-locked object anchor, the
 * production dependency wiring and the Recall action.
 *
 * Data note (not changed here): docs/plans/survey/data-issues-recheck.md marks
 * `ogs-020-024` as resolved and quotes the S-ORIGINS wording ("...would die this
 * turn, heal it, exhaust it, and recall it instead"), but the refreshed local
 * catalogue still reads "dies ... recall it exhausted" (verified in
 * packages/card-data/data/deck-catalog.json). This program follows the local
 * sourceText verbatim as required; the difference is reported to the
 * coordinator instead of being silently rewritten.
 */
const highlanderYi = {
  canonicalCardId: "card.hash-65c099c33a6f39283027cbf4532037cbd7fe982a1e896afd5bf5d35e0fc16512",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "登记原语已合入（RIFT-595 注册了 replacement.event；其 next-time-this-turn 一次性窗口、" +
    "{ linked: \"replacement.object\" } 的被替代事件对象绑定与 effect.exhaust 的 planner 映射均已真实执行，见 golden），" +
    "但本卡的印刷能力仍不可执行，三处都是当前缺口：" +
    "(1) 登记无法锚定到所选单位：replacement.event 对任何 args.object 抛 BlockedReplacementError" +
    "（\"replacement.event object binding needs a Finalize target adapter\"），" +
    "355.10.c 的被选单位 TargetSpec 不能成为死亡模式的对象锚点；省略 object 会让模式匹配本回合任意对象的第一次死亡" +
    "（golden 实测无锚定的合并登记也替代了敌方单位的死亡），因此不得省略；" +
    "(2) 打出体的登记在生产链里仍不可达：chain 解释器重建指令 ResolveContext 时不转发 replacement/replacementDependencies 扩展，" +
    "即使形状合法也 fail-closed 为 \"replacement instruction requires ResolveContext.replacement dependencies (host + pipeline)\"；" +
    "合并接缝尚无生产调用方（测试内核与 RIFT-595 harness 手工注入）；" +
    "(3) Recall 无法执行也无法近似：effect.move mode \"recall\" 被原语显式阻断（封闭 move-location 动作无法区分 Recall 与 Move，" +
    "CR 457-460），合并 planner 对该 mode 抛 BlockedReplacementError，而用普通移动顶替会错误触发 Move 触发（458.1）并改变状态" +
    "（460.1 要求 Recall 不影响状态，印刷的 exhausted 是本卡写明的例外）；封闭 GameAction 词表没有 recall 动作，也没有 effect.recall。" +
    "不近似实现；“Choose a friendly unit”本身是目标（355.10.c 示例）并且已按 TargetSpec 编码。" +
    "依赖：replacement.event 的 Finalize 锁定对象锚点、替代依赖的生产链接线，以及 Recall 独立动作（457-460）。",
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
          // exhausted instead." The choice is a target (355.10.c); the
          // registration is a Delayed Replacement (391.3) whose one-shot
          // window is the merged next-time-this-turn lifetime. The chosen unit
          // cannot be bound as the pattern anchor yet (see judgeReason), so
          // the shape is recorded as data only.
          id: "highlander-yi.register-death-replacement",
          op: "replacement.event",
          args: {
            event: { kind: "constant", value: { event: "object-killed" } },
            window: { kind: "constant", value: "next-time-this-turn" },
            // The death pattern's object anchor: the previously chosen unit
            // (355.10.c). The merged instruction rejects this argument
            // outright; naming the TargetSpec keeps the reviewed intent
            // instead of silently broadening the pattern to any death.
            object: { kind: "constant", value: "highlander-yi.chosen-unit" },
            instead: {
              kind: "constant",
              value: [
                {
                  // "recall it ...": a Recall (457), not a Move (458.1).
                  id: "highlander-yi.recall",
                  op: "effect.move",
                  args: {
                    // "it" is the intercepted object of the death event
                    // (355.10.c). The registration is anchored to the chosen
                    // unit, so this resolves to that unit once the anchor is
                    // bindable; the merged planner supports the linked
                    // spelling and blocks the Recall mode by rule (457-460).
                    objects: { kind: "constant", value: { linked: "replacement.object" } },
                    to: { kind: "constant", value: "controller-base" },
                    mode: { kind: "constant", value: "recall" }
                  }
                },
                {
                  // "...exhausted": 460.1's stated exception, applied as part
                  // of the replaced outcome. It names the same intercepted
                  // unit (355.10.c: "it" is not a new target choice).
                  id: "highlander-yi.exhaust-recalled",
                  op: "effect.exhaust",
                  args: { target: { kind: "constant", value: { linked: "replacement.object" } } },
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

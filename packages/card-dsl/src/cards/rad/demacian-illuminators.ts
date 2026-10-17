import type { CardProgram } from "../../ir/index.js";

/**
 * Demacian Illuminators — rad-131-167 (Spell, Order, 3 Energy + 1 Order Power).
 *
 * Printed text (verbatim, deck-catalog rad-131-167):
 *   "When one or more friendly units die, [Buff] a friendly unit.
 *    (Give it a +1 :rb_might: buff if it doesn't have one.)"
 *
 * Modeling notes (Core Rules v1.5):
 * - "When one or more friendly units die" is a single Triggered Ability
 *   (383.1) whose Condition is a batch of deaths: 370.1.a.2 — events are
 *   simultaneous only when they result from the same game action or state
 *   change. The ability therefore fires once per game action that kills one or
 *   more friendly units, not once per unit.
 * - The death timing point is "object-killed" (events/timing-points.ts, refs
 *   429.1 / 429.2), and the filter narrows the event object to a unit the
 *   ability controller controls (355.10.c: the trigger clause names no target).
 * - "[Buff] a friendly unit" is the game action "Buff [one or more units]"
 *   (427.3, 427.2.a): exactly one friendly unit is chosen, and a unit that
 *   already has a Buff is simply not Buffed again (427.1.b.1 / 427.3). The
 *   merged effect.buff primitive covers the whole action, including the
 *   already-buffed no-op, so only the trigger side is unresolved.
 *
 * Status: judge-required. The merged event pipeline scans triggers once per
 * "object-killed" event and exposes no batch lifetime — TriggerSpec.once only
 * offers per-turn / per-combat / per-chain / per-game, and the reference kernel
 * emits one death event per killed object — so "one or more ... die" cannot be
 * expressed without firing the ability once per dying unit (a real semantic
 * difference under 370.1.a.2). The [Buff] body itself is fully executable and
 * is covered by the golden test. No semantics are approximated.
 *
 * Re-check (2026-10-17 second coverage re-sweep): the event pipeline now
 * publishes `simultaneousGroup` on its emissions (events/pipeline.ts groups
 * by it), but TriggerSpec.once still only offers per-turn / per-phase /
 * per-combat / per-showdown / per-chain / per-object / per-game keyed on a
 * single registration + source, so a batch lifetime is still missing. The
 * CardProgram trigger adapter is already merged; it is not a remaining gap.
 *
 * Contract change request: TriggerSpec needs a batch/coalescing lifetime (for
 * example once: "per-batch", or an event-payload simultaneous-group key) for
 * "when one or more ..." conditions; this is a contract change request for
 * the events/trigger workstream.
 */
export default {
  canonicalCardId: "card.hash-f6f48abbdfa8b29547d87803b943b002bce1b314d44763556dcb0f98a9b19c86",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺「one or more … die」的批次触发语义：370.1.a.2 把同一次游戏动作造成的多个死亡视为同时事件，" +
    "「When one or more friendly units die」应每个批次只触发一次；已合入的事件管线虽在各 emission 上带 " +
    "simultaneousGroup（events/pipeline.ts 按组发布），但 TriggerSpec.once 仍只有 per-turn / per-phase / " +
    "per-combat / per-showdown / per-chain / per-object / per-game（频度键 = 单个注册 + 来源），" +
    "没有批次频度、也没有读取事件同时组键的口子，按现结构会每个死亡单位各触发一次（语义差异，非近似实现）。" +
    "CardProgram 的 triggered ability 注册路径已合入；当前仅缺事件管线按 simultaneousGroup 对同一死亡批次去重。" +
    "「[Buff] a friendly unit」本体已由已合入的 effect.buff 覆盖并有真实执行测试。" +
    "依赖：TriggerSpec 的批次频度契约变更；不近似实现。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "object-killed",
        filter: {
          event: "object-killed",
          object: { type: "unit", controller: "self" }
        }
      },
      optional: false,
      body: [
        {
          id: "demacian-illuminators.buff",
          op: "effect.buff",
          args: {
            mode: { kind: "constant", value: "buff" },
            target: { kind: "constant", value: "demacian-illuminators.friendly-unit" }
          },
          targets: [
            {
              id: "demacian-illuminators.friendly-unit",
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
    "When one or more friendly units die, [Buff] a friendly unit. " +
    "(Give it a +1 :rb_might: buff if it doesn't have one.)"
} satisfies CardProgram;

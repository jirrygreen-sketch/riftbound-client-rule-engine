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
 * Re-check (2026-10-17 third coverage re-sweep): the event pipeline publishes
 * `simultaneousGroup` on its emissions (events/pipeline.ts groups by it), but
 * TriggerSpec.once still only offers per-turn / per-phase / per-combat /
 * per-showdown / per-chain / per-object / per-game and the frequency key is
 * built from the registration id plus its source incarnation, never from the
 * event's group. Verified by running the merged pipeline over one kill batch
 * of two friendly units: the single registration fires twice (once per killed
 * object), which is the semantic difference 370.1.a.2 forbids. The CardProgram
 * trigger adapter is already merged; it is not a remaining gap.
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
    "该能力应每个 simultaneousGroup 只触发一次。当前 EventPipeline 仍按每个 object-killed emission 扫描，" +
    "TriggerSpec.once 也没有 per-batch 频度或按 simultaneousGroup 去重的契约；同一批次两次死亡实测会触发两次，" +
    "与印刷文本不符。effect.buff（427.1.b.1 / 427.3）本体已有真实执行证据；缺口只在死亡批次聚合，不能近似实现。",
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

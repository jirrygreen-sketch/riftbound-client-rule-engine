import type { CardProgram } from "../../ir/index.js";

/**
 * Eclipse Herald (ogn-059-298) — Unit, 7 energy + 1 Calm power, Might 7.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, ogn-059-298):
 *   When you stun an enemy unit, ready me and give me +1 :rb_might: this turn.
 *
 * Rules evidence (Core Rules v1.5):
 * - "When you stun an enemy unit" is a state trigger on the stun event:
 *   Stunning is the action of rendering Units Stunned (424.1), and a Stunned
 *   Unit can not be Stunned again (424.1.a.1) — the rules use this very card as
 *   the example: choosing an already-stunned unit is legal but does not make
 *   the ability trigger. The merged engine has the timing point `unit-stunned`,
 *   emitted by the action adapter for a successful stun action
 *   (events/action-adapter.ts; timing-points.ts: unit-stunned fires only when a
 *   unit goes from not-Stunned to Stunned), and the merged effect.stun reports
 *   alreadyStunned without emitting the event. "you stun" responsibility comes
 *   from 412.4/412.5 (attribution), so the trigger carries the controller's
 *   player selector rather than a source restriction: the enemy unit is the
 *   event object, and this card is not the source of the stun.
 * - "ready me": the merged effect.ready primitive with its default selection,
 *   the ability source (355.10.g / 412.4); already-ready units are left
 *   untouched (416.1.b/416.1.c).
 * - "and give me +1 :rb_might: this turn": a temporary Might modification with
 *   an end-of-turn duration, executed through continuous.might and the layers engine.
 *
 * Status: judge-required.
 * - "give me +1 [M] this turn" is a temporary Might modification. The merged
 *   continuous.might instruction and layer engine consume it; CardProgram
 *   triggered ability registration remains an adapter concern.
 * - one half of the trigger is separately not executable in production: the
 *   `unit-stunned` timing point has its emitter only in the action pipeline
 *   adapter (events/action-adapter.ts), which today is used only by engine-core
 *   tests (packages/engine-core/test/chain/helpers.mjs) — the merged ChainEngine
 *   itself does not install it. That wiring belongs to the engine batch
 *   (RIFT-120 chain/events) and is not part of this card's write scope.
 * The merged effect.ready half is executed by the golden test; the +1 Might is
 * not approximated with a Buff counter.
 */
export default {
  canonicalCardId: "card.hash-67719b3d2e3e5ab46c7824a9f7d294656d3d356fc92ad47c06b92e52e7f62fc1",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "continuous.might 与 end-of-turn 图层消费已经合入（RIFT-258/259），且 +1 Might 局部效果可由解释器真实执行；" +
    "仍缺 CardProgram 触发能力到正式事件/链管线的绑定，尤其是 unit-stunned 时点在 ChainEngine 中的触发注册与控制者过滤" +
    "（CR 424.1/424.1.a.1；RIFT-257、RIFT-270）。不近似实现，不用 Buff 计数器冒充 +1 Might；" +
    "「ready me」本体（effect.ready，416.1）已合入并在 golden 中真实执行。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "unit-stunned",
        // The stunned unit is the event object; "enemy unit" is relative to this
        // ability's controller, which the merged event matcher resolves from the
        // registration controller (events/pipeline-match.ts playerMatches).
        filter: { event: "unit-stunned", object: { type: "unit", controller: "opponent" } }
      },
      optional: false,
      body: [
        {
          // "ready me" — default selection is the ability source (355.10.g).
          id: "eclipse-herald.ready-me",
          op: "effect.ready",
          args: {}
        },
        {
          id: "eclipse-herald.give-plus-1-might",
          op: "continuous.might",
          args: {
            amount: { kind: "constant", value: 1 },
            duration: { kind: "constant", value: "end-of-turn" },
            objects: { kind: "constant", value: { kind: "source" } }
          }
        }
      ]
    }
  ],
  sourceText: "When you stun an enemy unit, ready me and give me +1 :rb_might: this turn."
} satisfies CardProgram;

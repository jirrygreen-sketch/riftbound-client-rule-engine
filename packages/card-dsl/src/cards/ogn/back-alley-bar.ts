import type { CardProgram } from "../../ir/index.js";

/**
 * Back-Alley Bar (ogn-277-298) — Battlefield, domainless.
 *
 * "When a unit moves from here, give it +1 :rb_might: this turn."
 *
 * CR v1.5 anchors:
 * - 421.1 / 449.1 / 449.2: Move is the action that changes a Permanent's
 *   Location; the "object-moved" timing point declares a movement payload
 *   (fromKind / fromLocationId / toKind / toLocationId, see
 *   events/timing-points.ts), but the adapter does not populate those fields. The
 *   merged action adapter emits the timing point for a successful
 *   move-location (events/action-adapter.ts).
 * - 458 / 458.1: a Recall is not a Move and does not trigger Move abilities,
 *   so the trigger keys on the Move timing point rather than on a generic
 *   location change.
 * - 355.10.c: the moved unit is mentioned only inside the trigger condition
 *   ("a unit moves from here"), so it is not a target; there is no Finalize
 *   target choice for this ability.
 * - 143.2.a / 478 / 317.1.a: "+1 [M] this turn" is a Might modification, not a
 *   Buff counter, executed by the merged continuous.might primitive (RIFT-258)
 *   with the end-of-turn duration; effect.buff (703 Buffs are counters) is not
 *   substituted.
 *
 * Status: judge-required. continuous.might executes, but three event seams
 * remain: object-moved is absent from the trigger validator's event vocabulary;
 * the actual action-adapter emission does not populate the declared origin
 * fields; and ObjectSelector cannot name the moved unit from the event.
 * The origin must bind dynamically to this battlefield, and Recall must stay
 * distinct from Move (458.1). The TargetSpec is a blocked structural stand-in,
 * not a target choice made by the printed text.
 */
export default {
  canonicalCardId: "card.hash-493d66d1c2a0fe93d708e9d2f3e005dc5a57140526eb8080cdad1ce0977c081a",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺三处事件接线：（1）object-moved 虽已发射，却不在 events/trigger-spec.ts 的 EVENT_PATTERN_TYPES 内，触发无法注册；（2）events/action-adapter.ts 的实际 Move 发射没有 fromKind/fromLocationId，timing-points.ts 的声明不等于载荷实现，且缺把起点 here 动态绑定到宿主战场的过滤器；（3）ObjectSelector 没有读取触发载荷中移动单位的入口，continuous.might 的 TargetSpec 只是占位，会错误要求文本未包含的目标选择（CR 355.10.c）。需保留 Move 与 Recall 的区别（CR 458.1）并对实际移动单位施加本回合 +1（317.1.a/478）。",
  sourceText: "When a unit moves from here, give it +1 :rb_might: this turn.",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "object-moved",
        // "from here": the Move's origin is this battlefield.
        filter: {
          event: "object-moved",
          object: { type: "unit" },
          details: { fromKind: "battlefield", fromLocationId: "self" }
        }
      },
      optional: false,
      body: [
        {
          // "give it +1 [M] this turn" — the merged continuous.might primitive
          // (RIFT-258) with the end-of-turn duration. The target is a
          // structural stand-in for the trigger payload's unit until the
          // event-object selector exists (see judgeReason).
          id: "back-alley-bar.give-might",
          op: "continuous.might",
          args: {
            amount: { kind: "constant", value: 1 },
            duration: { kind: "constant", value: "this-turn" },
            objects: {
              kind: "constant",
              value: { kind: "target", id: "back-alley-bar.moved-unit" }
            }
          },
          targets: [
            {
              // Structural stand-in: the printed text never chooses a target
              // (355.10.c); the triggering unit would be named through the
              // missing event-object selector.
              id: "back-alley-bar.moved-unit",
              filter: { type: "unit", zone: "board" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ]
} satisfies CardProgram;

import type { CardProgram } from "../../ir/index.js";

/**
 * Back-Alley Bar (ogn-277-298) — Battlefield, domainless.
 *
 * "When a unit moves from here, give it +1 :rb_might: this turn."
 *
 * CR v1.5 anchors:
 * - 421.1 / 449.1 / 449.2: Move is the action that changes a Permanent's
 *   Location; the "object-moved" timing point carries the movement payload
 *   (fromKind / fromLocationId / toKind / toLocationId, see
 *   events/timing-points.ts), and "from here" is that payload's origin. The
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
 * Status rationale (contract §3.1, cards README §2): the Might half now
 * executes on merged paths (the golden drives the card's own instruction
 * through the merged primitive and layer engine), but the card cannot run end
 * to end:
 * - the affected object: "it" is the unit from the trigger payload. The frozen
 *   ObjectSelector set is self / source / target / pick / linked, and none of
 *   them can name a triggering event's object, so the body cannot reference its
 *   subject today (recorded as a contract change request in the task reply);
 *   the TargetSpec below is a structural stand-in, not a choice the printed
 *   text ever makes;
 * - the trigger subscription: the nested `{ event, details }` spelling is
 *   rejected by the engine validator (events/trigger-spec.ts rejects the
 *   object-moved event name and the inner filter shape), and no merged consumer
 *   binds a CardProgram's triggered ability into a TriggerRegistration
 *   (RIFT-257).
 *
 * The trigger and the intended layers-contract body shape are kept so the
 * missing pieces stay auditable.
 */
export default {
  canonicalCardId: "card.hash-493d66d1c2a0fe93d708e9d2f3e005dc5a57140526eb8080cdad1ce0977c081a",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处缺口：(1)「it」指触发载荷中的被移动单位，而冻结的 ObjectSelector 集合（self/source/target/pick/linked）没有事件对象选择器，" +
    "body 里的 TargetSpec 只是结构性占位、不是印刷文本会做的选择（契约变更请求）；" +
    "(2) 触发无法注册：嵌套 { event, details } 拼写被引擎侧 assertTriggerSpec 拒绝" +
    "（events/trigger-spec.ts 不认 object-moved 这一事件名与内层 details），且没有已合入消费方把 CardProgram 的 triggered 能力绑定成 TriggerRegistration（RIFT-257）。" +
    "这片段仍必须按 458.1 排除 Recall、按载荷起点「from here」过滤（RIFT-120 触发工作流）。" +
    "Might 半段（continuous.might，143.2.a/478/317.1.a）已合入并由 golden 真实执行并断言登记、+1 生效值与回合末到期。" +
    "依赖：事件对象选择器（契约变更请求）、RIFT-257、RIFT-120。不近似实现。",
  sourceText: "When a unit moves from here, give it +1 :rb_might: this turn.",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "object-moved",
        // "from here": the Move's origin is this battlefield.
        filter: {
          event: "object-moved",
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

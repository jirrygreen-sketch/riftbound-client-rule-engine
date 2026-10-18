import type { CardProgram } from "../../ir/index.js";

/**
 * Irresistible Faefolk (unl-112-219) — Unit, Body, Fae/Ionia; energy 2, Might 1.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, unl-112-219, verbatim):
 *   When I move to a battlefield, you may move an enemy unit to that battlefield.
 *
 * Rules evidence (Core Rules v1.5):
 * - 421.1 / 449.1 / 449.2: a Move is defined by Origin and Destination; the
 *   closed timing point is "object-moved" (events/timing-points.ts), and 458
 *   keeps a Recall (Battlefield→Base, not a Move) out of this trigger.
 * - 383.3.a.3: "you may" is the first part of the effect, so the decision is
 *   made when this triggered ability is finalized/resolved; contract 3.9 writes
 *   it as choice.optional with the chosen instruction inside its body.
 * - 355.5 / 355.7: "an enemy unit" is chosen by the ability's controller and is
 *   therefore a target (TargetSpec). "to that battlefield" is the Destination of
 *   the triggering Move, captured when the trigger condition is fulfilled (359.3.f.3).
 * - 421.2.a / 451: this is an effect Move, so no exhaust cost applies; the
 *   frozen effect.move primitive submits the move-location action. "that
 *   battlefield" uses the merged source-location expression over the captured
 *   trigger source, rather than the source object's later live location.
 *
 * Status: judge-required (re-verified against the merged sources, 2026-10-17). The
 * remaining gap is the object-moved event vocabulary and the Destination payload:
 * the closed EVENT_PATTERN_TYPES (events/trigger-spec.ts) has no "object-moved"
 * spelling even though the timing point exists, and validateTriggerSpec rejects the
 * registration with invalid-event-type. The Destination gate is now carried by the
 * already-supported EventPattern fields (source:"self" + toZone:"battlefield")
 * instead of the unsupported descriptive movedToBattlefield key, and the host anchor
 * uses the preserved source: "self" spelling (the nested object: "self" form is
 * dropped by programs/filters.ts). action-adapter.ts still emits object-moved without
 * fromKind/toKind/fromLocationId/toLocationId, so no matcher could test the
 * Destination even after the vocabulary is extended (449.2, 359.3.f.3). The merged
 * location expression resolves the captured source snapshot, so later moves or zone
 * exits do not redirect this instruction (359.3.f.3). The original optional body has
 * real execution coverage; it does not prove the missing event registration.
 */
export default {
  canonicalCardId: "card.hash-bd638db89dd40b1e7a4af53d4b6502145b269d568f69478b4f5e9f979e6a89c3",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "仍缺 object-moved 触发的生产绑定（CR 449.2、359.3.f.3）：封闭 EVENT_PATTERN_TYPES 未收录 object-moved" +
    "（validateTriggerSpec 以 invalid-event-type 拒绝该订阅）；目的地闸门已改用已支持的事件模式字段 " +
    "source:\"self\" + toZone:\"battlefield\"（translateTriggerFilter 实测能保留宿主 objectId 与 toZone），" +
    "原来的描述性 movedToBattlefield 键只被 translateObjectFilter 拒绝、无法表达目的地。" +
    "action-adapter.ts 的 object-moved 发射仍不带 fromKind/toKind/fromLocationId/toLocationId，" +
    "即使补上词汇也没有可匹配的 toZone 载荷。" +
    "选中的敌方单位、源快照捕获（359.3.f.3）与 effect.move 本体已有真实执行证据。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "object-moved",
        filter: {
          event: "object-moved",
          // “When I move”：事件对象是本卡。用被 translateTriggerFilter 保留的
          // source: "self" 拼写，嵌套 object: "self" 会被静默丢弃。
          source: "self",
          // “to a battlefield”：目的地种类必须为战场（449.2）。用已支持的 EventPattern
          // toZone 字段表达；生产 object-moved 发射未填充该载荷，因此仍需词汇 + 载荷接线。
          toZone: "battlefield"
        }
      },
      optional: true,
      body: [
        {
          id: "irresistible-faefolk.move-opt",
          op: "choice.optional",
          args: {
            prompt: { kind: "constant", value: "Move an enemy unit to that battlefield?" },
            body: {
              kind: "constant",
              value: [
                {
                  id: "irresistible-faefolk.move-enemy",
                  op: "effect.move",
                  args: {
                    objects: {
                      kind: "constant",
                      value: { target: "irresistible-faefolk.enemy-unit" }
                    },
                    // 359.3.f.3：链上下文 source 是触发时的快照；随后移动不改指代。
                    to: { kind: "location", value: "source-location" },
                    amount: { kind: "constant", value: 1 },
                    linkKey: { kind: "constant", value: "moved" }
                  }
                }
              ]
            }
          },
          // Lock the enemy target when finalizing this optional ability (355.5.b).
          targets: [
            {
              id: "irresistible-faefolk.enemy-unit",
              filter: { type: "unit", zone: "board", controller: "opponent" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ],
  sourceText: "When I move to a battlefield, you may move an enemy unit to that battlefield."
} satisfies CardProgram;

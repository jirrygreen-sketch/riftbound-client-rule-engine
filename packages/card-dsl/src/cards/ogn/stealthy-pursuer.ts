import type { CardProgram } from "../../ir/index.js";

/**
 * Stealthy Pursuer (ogn-177-298) — Unit, Chaos (Shurima).
 *
 * sourceText (packages/card-data/data/deck-catalog.json, ogn-177-298):
 *   When a friendly unit moves from my location, I may be moved with it.
 *
 * Modeling (CR v1.5):
 * - The trigger is the object-moved timing point (421.1 / 449.1, payload
 *   fromKind/fromLocationId/toKind/toLocationId). "a friendly unit" = a unit
 *   controlled by this ability's controller. "moves from my location" must
 *   compare the event's FROM location with the ability host's current
 *   location: the closed TriggerSpec/ObjectFilter vocabulary has no from-
 *   location anchor (only sameLocationAs compares current locations), so the
 *   fromSameLocationAs key below records the intended predicate without
 *   pretending it is evaluable.
 * - "I may be moved with it" is the ability controller's finalization choice
 *   (383.3.a), hence optional: true. The follow-up Move's destination is the
 *   destination of the unit that moved; IR has no selector for event payload
 *   values (contract 3.6 selectors are self/source/target/pick/linked), so the
 *   destination below is a clearly-nominal placeholder and the card stays
 *   judge-required rather than approximating the move.
 * - Additional merged-state notes: the object-moved payload fields exist in
 *   the timing-point audit (events/timing-points.ts payloadFields), and the
 *   engine's EventPattern reads concrete values only (details: { fromLocationId:
 *   <id> }), which static IR cannot supply for a runtime location; the
 *   engine-side EventPattern vocabulary does not accept the object-moved event
 *   name either. The trigger registration path exists, but this pattern still
 *   needs the event matcher and payload binding.
 */
export default {
  canonicalCardId: "card.hash-ba317497fb11f0057ab92dddc2368fdcdf29656f88954eb40ed97277241324c5",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "当前有两块缺口：(1)「a friendly unit moves from my location」需要把 object-moved 事件的起止地点" +
    "（payload 字段 fromKind/fromLocationId/toKind/toLocationId，见 events/timing-points.ts 的 payloadFields）" +
    "与能力宿主当前位置比较：关闭的 ObjectFilter/TriggerSpec 只有 sameLocationAs（比较当前地点），" +
    "EventPattern 的 details 只能写死具体 id，静态 IR 无法引用宿主运行时的地点身份；" +
    "且引擎侧 EventPattern 事件词表不包含 object-moved，触发规格验证与匹配器因此无法消费该事件名。" +
    "(2)「I may be moved with it」需要以该次 Move 的 to 地点作为 effect.move 的目标，IR 的 ObjectSelector/Expr" +
    "没有事件 payload 选择器（契约 3.6：选择器只有 self/source/target/pick/linked）。" +
    "依赖：object-moved 的 EventPattern 词表/匹配器、fromLocationId 与宿主地点的动态比较，以及 effect.move 的事件 payload 目的地选择器（见本任务契约变更请求）；不近似实现。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "object-moved",
        filter: {
          event: "object-moved",
          filter: { controller: "self", type: "unit", fromSameLocationAs: "self" }
        }
      },
      optional: true,
      body: [
        {
          id: "stealthy-pursuer.move-with-it",
          op: "effect.move",
          args: {
            objects: { kind: "constant", value: "self" },
            // Nominal placeholder: the real destination is the destination of the
            // friendly unit that moved (event payload). No IR selector can read it
            // yet; see judgeReason and the contract change request.
            to: { kind: "constant", value: { type: "battlefield", id: "event-destination" } },
            linkKey: { kind: "constant", value: "moved-with-it" }
          }
        }
      ]
    }
  ],
  sourceText: "When a friendly unit moves from my location, I may be moved with it."
} satisfies CardProgram;

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
 */
export default {
  canonicalCardId: "card.hash-ba317497fb11f0057ab92dddc2368fdcdf29656f88954eb40ed97277241324c5",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两块依赖未合入：(1)「a friendly unit moves from my location」需要把 object-moved 事件 payload 的" +
    " fromLocationId/fromKind 与能力宿主当前位置比较，关闭的 ObjectFilter/TriggerSpec 只有 sameLocationAs" +
    "（比较当前地点）而没有 from 地点锚点；(2)「I may be moved with it」需要以该次 Move 的 to 地点作为" +
    " effect.move 的目标，IR 的 ObjectSelector/Expr 没有事件 payload 选择器（契约 3.6）。" +
    "依赖：RIFT-90（target/event 适配）与事件 payload 选择器扩展（见本任务契约变更请求）；不近似实现。",
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

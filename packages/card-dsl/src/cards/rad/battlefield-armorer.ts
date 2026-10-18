import type { CardProgram } from "../../ir/index.js";

/**
 * Battlefield Armorer — rad-130-167 (Spell, Order, 3 Energy, no printed Power).
 *
 * Printed text (packages/card-data/data/deck-catalog.json, rad-130-167, verbatim):
 *   "When a friendly gear at a battlefield dies, you may pay :rb_energy_1: to
 *    return it to its owner's hand."
 *
 * Modeling notes (Core Rules v1.5):
 * - "When a friendly gear at a battlefield dies" is a Triggered Ability
 *   (383.1) whose Condition is the gear dying; the death timing point is
 *   `object-killed` (events/timing-points.ts, refs 429.1 / 429.2 / 808.1.d) and
 *   the filter narrows the event object to a gear the ability controller
 *   controls (355.10.c: the trigger clause names a category, not a target) that
 *   was at a battlefield when it died ("at a battlefield" is a restriction on
 *   the unit that died, 355.10.b).
 * - "you may pay :rb_energy_1: to return it …" is a cost within instructions at
 *   the start of the effect (204.3, 383.3.b): the controller may decline, so the
 *   printed "you may" is written as `choice.optional` wrapping the payment and
 *   the return (contract 3.9: the selected instructions live in `body`, never a
 *   choice plus a `linkedTo` consumer).
 * - "return it to its owner's hand" is a zone change of the gear that died; the
 *   gear is no longer on the Board at resolution, so the instruction refers to
 *   it through the trigger's event object (355.10.c).
 *
 * Status: judge-required. The "at a battlefield" restriction is now
 * expressible: the trigger matcher matches the `zone: "battlefield"` filter
 * against the pre-move snapshot (`location?.type`), so the filter below is
 * evaluated by the merged matcher and has a golden execution test. The
 * remaining gaps:
 * - "return it to its owner's hand" needs an event-object selector: the gear
 *   has already left the Board when the trigger resolves, and the merged
 *   pick/target system cannot name it (CR 355.10.c / 359.3.e.13);
 * - Optional payment still needs a savepoint/skip boundary: cost.pay throws on
 *   failure, while choice.optional only models the player accepting/declining.
 * The cost.pay primitive and trigger binding are merged; the payment uses the
 * current `payments` shape below.
 * No semantics are approximated: the ability keeps its declared shape.
 */
export default {
  canonicalCardId: "card.hash-5ded292f5616ea4fbb22076ef9ee2421ef6458f0ce8eda2335e14bb61716771c",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺死亡事件对象到 Trash 当前 incarnation 的符号绑定：object-killed 的 object 保留换区前快照，" +
    "当前 pick/target 不会把旧 zoneEntryId 自动重绑（CR 124 / 355.10.c / 359.3.e.13）；" +
    "ObjectSelector 没有事件对象形式，dynamic:dying-gear 也不是可执行 PickSpec 来源。" +
    "还需成本内可选支付的失败跳过/事务边界：cost.pay 在不可支付时抛 CostPlanError，" +
    "现有 choice.optional 没有支付失败后仅跳过 return 的适配（203.3）。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "object-killed",
        filter: {
          event: "object-killed",
          // 355.10.b：死亡时位于「某个」战场。合并匹配器按换区前快照的
          // location.type 求值 zone: "battlefield"，基地死亡不会命中。
          object: { type: "gear", controller: "self", zone: "battlefield" }
        }
      },
      optional: false,
      body: [
        {
          id: "battlefield-armorer.opt-in",
          op: "choice.optional",
          args: {
            prompt: { kind: "constant", value: "Pay 1 energy to return the gear to its owner's hand?" },
            body: {
              kind: "constant",
              value: [
                {
                  id: "battlefield-armorer.pay",
                  op: "cost.pay",
                  args: { payments: { kind: "constant", value: { energy: 1 } } }
                },
                {
                  // "return it to its owner's hand" — the dying gear is named
                  // through the trigger's event object; the merged pick/target
                  // system cannot reference an object that already left the
                  // Board (see judgeReason).
                  id: "battlefield-armorer.return",
                  op: "effect.zone",
                  linkedTo: "battlefield-armorer.pay",
                  args: {
                    pick: { kind: "constant", value: "battlefield-armorer.dying-gear" },
                    to: { kind: "constant", value: "hand" }
                  },
                  picks: [
                    {
                      id: "battlefield-armorer.dying-gear",
                      // The dying gear is identified by the trigger event
                      // itself; the merged pick system cannot enumerate an
                      // object that already left the board (355.10.c /
                      // 359.3.e.13 — see judgeReason).
                      options: ["dynamic:dying-gear"],
                      min: 1,
                      max: 1,
                      selection: "one"
                    }
                  ]
                }
              ]
            }
          }
        }
      ]
    }
  ],
  sourceText: "When a friendly gear at a battlefield dies, you may pay :rb_energy_1: to return it to its owner's hand."
} satisfies CardProgram;

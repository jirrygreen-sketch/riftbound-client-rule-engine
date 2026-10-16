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
 * Status: judge-required. The trigger and the return are expressible, but the
 * "at a battlefield" restriction cannot be evaluated on the death event. The
 * merged pipeline does keep the dying object's location for `object-killed`
 * (action-adapter.ts snapshots the pre-move object), but the trigger matcher's
 * only location field compares against one concrete location (pipeline-match.ts:
 * battlefield objects compare against `location.id`, and a base against the
 * literal "base"), so "died at *a* battlefield" has no card-facing predicate.
 * effect.zone also cannot select an object that has already left the Board
 * through a pick. No semantics are approximated: the ability is written out so
 * the missing filter form is reviewable.
 */
export default {
  canonicalCardId: "card.hash-5ded292f5616ea4fbb22076ef9ee2421ef6458f0ce8eda2335e14bb61716771c",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺「死亡时位于战场」的触发过滤条件：object-killed 虽保留换区前的对象快照（action-adapter.ts），" +
    "但触发匹配器唯一的 location 字段按具体地点比较（战场为 location.id、基地为字面量 \"base\"，pipeline-match.ts），" +
    "卡牌侧无法表达「a gear at *a* battlefield dies」这一 CR 355.10.b 的受限条件，因此整卡保持 judge-required。" +
    "同时「return it … to its owner's hand」需要在对象已离场后按事件对象回收（355.10.c / 359.3.e.13），" +
    "当前 pick/target 只能引用仍在原区的对象。依赖：RIFT-90（目标/过滤系统）与 object-killed 载荷过滤扩展；不近似实现。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "object-killed",
        filter: {
          event: "object-killed",
          object: { type: "gear", controller: "self" }
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
                  args: { energy: { kind: "constant", value: 1 } }
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
                      // object that already left the board (356.10.c /
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

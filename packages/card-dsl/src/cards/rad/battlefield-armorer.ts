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
 * - "you may pay :rb_energy_1:" needs the cost.pay instruction primitive and
 *   its Finalize/payment wiring (RIFT-261);
 * - "return it to its owner's hand" needs an event-object selector: the gear
 *   has already left the Board when the trigger resolves, and the merged
 *   pick/target system cannot name it (CR 355.10.c / 359.3.e.13);
 * - the trigger subscription needs the CardProgram → TriggerRegistration
 *   binding (RIFT-257).
 * No semantics are approximated: the ability keeps its declared shape.
 */
export default {
  canonicalCardId: "card.hash-5ded292f5616ea4fbb22076ef9ee2421ef6458f0ce8eda2335e14bb61716771c",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口：(1)「you may pay :rb_energy_1:」需要 cost.pay 指令原语与 Finalize 收费接线（RIFT-261）；" +
    "(2)「return it … to its owner's hand」需要在对象已离场后按事件对象回收（355.10.c / 359.3.e.13），" +
    "当前 pick/target 只能引用仍在原区的对象，ObjectSelector 没有事件对象形式；" +
    "(3) 触发订阅需要 CardProgram → TriggerRegistration 绑定（RIFT-257）。" +
    "「died at a battlefield」的 355.10.b 限制已可由合并匹配器的 zone:\"battlefield\" 过滤表达" +
    "（pipeline-match.ts 用换区前快照的 location.type 求值）并有真实匹配执行测试；不近似实现。",
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

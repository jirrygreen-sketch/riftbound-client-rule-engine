import type { CardProgram } from "../../ir/index.js";

/**
 * Eclipse Herald — CR v1.5 412.1/412.4 and 424.1.a.1.
 * The merged program/event binding can register the trigger and execute both
 * effects. It still needs the responsible player of a Stun action: the action
 * adapter currently derives player from the stunned unit controller.
 */
export default {
  canonicalCardId: "card.hash-67719b3d2e3e5ab46c7824a9f7d294656d3d356fc92ad47c06b92e52e7f62fc1",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "仍缺 unit-stunned 的行动责任玩家：events/action-adapter.ts 对 stun 取受眩晕单位的 controller 作为 event.player，GameAction.stun 未携带实际行动玩家，无法按 CR 412.1/412.4 区分「你眩晕敌方单位」和其他玩家眩晕；不能删除 player 条件来放宽触发。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "unit-stunned",
        // The stunned unit is the event object; "enemy unit" is relative to this
        // ability's controller, which the merged event matcher resolves from the
        // registration controller (events/pipeline-match.ts playerMatches).
        filter: { event: "unit-stunned", player: "controller", object: { type: "unit", controller: "opponent" } }
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

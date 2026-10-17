import type { CardProgram } from "../../ir/index.js";

/**
 * Eclipse Herald — CR v1.5 412.1/412.4 and 424.1.a.1.
 * The merged program/event binding registers the trigger and both effects
 * execute through supported primitives; repeated grants use distinct
 * settlement identities. It still needs Stun responsibility propagation.
 */
export default {
  canonicalCardId: "card.hash-67719b3d2e3e5ab46c7824a9f7d294656d3d356fc92ad47c06b92e52e7f62fc1",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "仍缺 unit-stunned 的行动责任玩家传播：effect.stun 提交的 GameAction.stun 只有 object，events/action-adapter.ts 因而把受眩晕单位的 controller 当作 event.player，未携带实际执行 Stun 的玩家（CR 412.1/412.4）；不能删去 player 条件。ready 与临时 Might 已可执行，且 settlement 标识已跨结算保持，多次 +1 可叠加。",
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

import type { CardProgram } from "../../ir/index.js";

/**
 * Imperial Decree — ogn-221-298 (Spell, Order, 5 Energy + 2 Order Power).
 *
 * Printed text (packages/card-data/data/deck-catalog.json, ogn-221-298):
 *   [Action] (Play on your turn or in showdowns.)
 *   When any unit takes damage this turn, kill it.
 *
 * Modeling notes (Core Rules v1.5):
 * - "[Action]" (806) is a permissive keyword expanded by the keyword registry
 *   (effects/keywords/Action.ts) into a continuous.timing static ability; the
 *   card only names it.
 * - "When any unit takes damage this turn, kill it" creates a Delayed Ability
 *   (390 / 391): a triggered ability with a window of applicability given by
 *   the effect. "When any unit takes damage" matches the `damage-dealt` timing
 *   point (events/timing-points.ts; 418.1.a / 418.1.b — emitted only for actual
 *   positive valid damage, 418.1.e / 418.1.e.1), and "this turn" is the
 *   duration (317.2.c: "3d. All 'this turn' effects expire simultaneously.").
 * - The ResolveContext side is expressible: ctx.registerDelayedTrigger(spec,
 *   body) exists in the frozen contract (3.6), and the chain adapter registers
 *   a delayed trigger. What is missing is the card-facing instruction: the
 *   current instruction registry has no trigger.delayed / trigger.state op, so
 *   no card program can subscribe to damage-dealt for the rest of the turn.
 *   Writing a triggered ability on the card would be wrong:
 *   a card's own triggered ability is a passive ability that exists while the
 *   card is on the board, not a one-shot delayed ability created by its
 *   resolution (391.1 / 393: Delayed Abilities are not associated with Units
 *   or Gear; they are created by other Abilities or Spells).
 * - "kill it" is a reference to the unit that just took damage, so the delayed
 *   body kills the event's object; the event payload carries the damaged unit
 *   (damage-dealt payloadFields include targetId).
 *
 * Status: judge-required. The delayed trigger is recorded as the pending
 * `trigger.delayed` instruction with the damage-dealt subscription and the
 * kill body; the card-facing opcode is not registered, so the subscription
 * cannot execute from this CardProgram.
 */
const imperialDecree = {
  canonicalCardId: "card.hash-a56576887313144ef13fd285dd3130fb460b1678a4a592a776002d9ef0757fb9",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "当前 instruction registry 没有卡牌可用的 trigger.delayed 注册入口（CR 390/391/393），" +
    "因此 CardProgram 无法调用已有的 ResolveContext.registerDelayedTrigger。接入后仍需把 " +
    "this-turn 映射到 expiry（317.2.c），将每次 damage-dealt 的 unit 事件对象绑定给 kill it，" +
    "并仅对实际正伤害触发（418.1.a/b/e）；不能改写为卡本体的常驻 triggered ability。",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 5 },
        power: { kind: "constant", value: 2 }
      },
      body: [
        {
          // "When any unit takes damage this turn, kill it" — the pending
          // delayed-trigger instruction. The window
          // is this turn (317.2.c) and the subscription is the damage-dealt
          // timing point (418.1.a / 418.1.b); the body kills the unit that
          // took the damage. No merged op consumes this yet (see judgeReason).
          id: "imperial-decree.delayed-kill",
          op: "trigger.delayed",
          args: {
            at: { kind: "constant", value: "damage-dealt" },
            filter: { kind: "constant", value: { types: "unit" } },
            duration: { kind: "constant", value: "this-turn" },
            body: {
              kind: "constant",
              value: [
                {
                  id: "imperial-decree.kill-damaged-unit",
                  op: "effect.kill",
                  args: {
                    // "kill it": the unit that just took the damage, carried by
                    // the damage-dealt event payload (targetId).
                    target: { kind: "constant", value: "imperial-decree.damaged-unit" }
                  },
                  targets: [
                    {
                      id: "imperial-decree.damaged-unit",
                      filter: { types: "unit" },
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
  sourceText:
    "[Action] (Play on your turn or in showdowns.)\n" +
    "When any unit takes damage this turn, kill it."
} satisfies CardProgram;

export default imperialDecree;

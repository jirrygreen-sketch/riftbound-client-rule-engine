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
 *   body) exists in the frozen contract (3.6) and the reference kernel records
 *   delayed triggers. What is missing is a *card-facing instruction* that
 *   registers the delayed trigger: the merged instruction registry has no
 *   trigger.delayed / trigger.state op (RIFT-9's trigger.delayed template,
 *   used by 2 cards), so no card program can subscribe to damage-dealt for the
 *   rest of the turn. Writing a triggered ability on the card would be wrong:
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
 * kill body; the merged registry cannot execute that op, so no execution test
 * claims it. RIFT-9 lists trigger.delayed as a required primitive.
 */
const imperialDecree = {
  canonicalCardId: "card.hash-a56576887313144ef13fd285dd3130fb460b1678a4a592a776002d9ef0757fb9",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺「本回合内任意单位受到伤害就消灭它」的延迟触发指令：该文本按 CR 390/391 生成一个 Delayed Ability" +
    "（392/393：由效果创建、不依附于战场上的卡），窗口为本回合（317.2.c 到期），订阅 damage-dealt 时点" +
    "（418.1.a/b，仅在实际造成正整数伤害时发出）。ResolveContext 侧已有 registerDelayedTrigger（契约 3.6），" +
    "但已合入的指令注册表没有卡牌可用的 trigger.delayed / trigger.state op（RIFT-9 清单中的 trigger.delayed），" +
    "因此卡程序无法注册该订阅；把能力写成卡自身的 triggered ability 会违反 391.1/393（延迟能力不依附卡本体）。" +
    "不近似实现；依赖 RIFT-9 的 trigger.delayed 原语落地。",
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
          // delayed-trigger instruction (RIFT-9 trigger.delayed). The window
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

import type { CardProgram } from "../../ir/index.js";

/**
 * rad-047-167 Fanfare (Spell, 3 energy, no power, no domain).
 *
 * Catalog evidence (packages/card-data/data/deck-catalog.json,
 * dataVersion 2026-10-12-official-gallery, printing rad-047-167):
 * energy 3, power null, might null, domains [], tags [].
 * `power: null` means there is no printed power, so the cost declares energy
 * only; the missing power is never rewritten as 0 (cards README section 2).
 *
 * Printed text (verbatim, sourceText):
 *   "The next three times you play a unit this turn, draw 1."
 *
 * Rules reading (CR v1.5):
 * - The resolving spell creates a Delayed Triggered Ability with a limited
 *   window and a limited number of uses: "the next three times you play a unit
 *   this turn" (391 Delayed Abilities, 391.2 Delayed Triggers; the window and
 *   the use count are set by the effect that creates the ability).
 * - Each use performs a Draw (414); "draw 1" is effect.draw with amount 1.
 *
 * Status: judge-required. Missing implementation (re-checked against the merged
 * ops):
 * - `ResolveContext.registerDelayedTrigger` exists (contract 3.6) and the chain
 *   engine implements it (src/chain/engine.ts registers the delayed trigger into
 *   the event pipeline), but no merged instruction under
 *   `effects/instructions/` exposes it as an opcode: the `trigger.delayed`
 *   template is still unmerged, so `trigger.delayed` below is a
 *   descriptive, unregistered op;
 * - `TriggerSpec.once` only offers per-turn / per-phase / per-combat /
 *   per-showdown / per-chain / per-object / per-game, so the "next three times"
 *   use counter cannot be stated with the merged trigger vocabulary;
 * - the end-of-turn expiry of the created delayed trigger needs a registration
 *   `expiresAt` / duration cleanup path for card-created delayed triggers
 *   (TriggerRegistration has `expiresAt`, but the delayed-registration path does not
 *   currently accept or propagate that expiry).
 * The body keeps that intended shape instead of approximating the three uses
 * with a single immediate draw or a permanent "whenever you play a unit"
 * trigger.
 */
export default {
  canonicalCardId: "card.hash-45b35ce91632cff6c42bf5bb1a2d9e4df42b52e6f58126dec199ced7ce391739",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺延迟触发注册的卡牌侧原语与“接下来三次”的用量计数：ResolveContext.registerDelayedTrigger 已在契约 3.6 " +
    "且 chain/engine.ts 已实现（把延迟触发注册进事件管线），但 effects/instructions/ 没有把它暴露成 opcode" +
    "（trigger.delayed 模板未合入，故本卡用未注册的描述性 op trigger.delayed 记录形状）；" +
    "TriggerSpec.once（events/trigger-spec.ts）只支持 per-turn / per-phase / per-combat / per-showdown / per-chain / per-object / per-game，" +
    "无法表达“本回合接下来三次打出单位”；本回合到期需要让卡牌侧延迟注册传递 expiresAt（TriggerRegistration 有该字段，但 registerDelayedTrigger 当前不接受期限）。" +
    "不近似实现（不用立即抽 1、也不用永久“每当你打出单位”触发代替）。",
  abilities: [
    {
      kind: "play",
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 3 }
      },
      body: [
        {
          // "The next three times you play a unit this turn, draw 1." — the
          // resolving spell registers one delayed triggered ability that fires
          // on the next three unit plays and expires at end of turn. The op is
          // not registered yet (see judgeReason); the nested body is the real
          // instruction the delayed trigger would execute.
          id: "fanfare.register-delayed-trigger",
          op: "trigger.delayed",
          args: {
            at: { kind: "constant", value: "card-played" },
            // The event pattern is descriptive data here. It is deliberately
            // NOT placed under an argument key literally named `filter`:
            // validateCardProgram treats an args key `filter` as an ObjectFilter
            // whose `object` anchor would have to be a symbolic selector, and
            // this is an EventPattern with a nested object filter, not an
            // ObjectFilter (contract 3.1 TriggerSpec.filter accepts either).
            eventFilter: {
              kind: "constant",
              value: {
                event: "card-played",
                // EventPattern.player takes a PlayerSelector ("self" |
                // "opponent" | "any" | { playerId }), not "controller".
                player: "self",
                object: { type: "unit" }
              }
            },
            uses: { kind: "constant", value: 3 },
            duration: { kind: "constant", value: "end-of-turn" },
            body: {
              kind: "constant",
              value: [
                {
                  id: "fanfare.draw",
                  op: "effect.draw",
                  args: { amount: { kind: "constant", value: 1 } }
                }
              ]
            }
          }
        }
      ]
    }
  ],
  sourceText: "The next three times you play a unit this turn, draw 1."
} satisfies CardProgram;

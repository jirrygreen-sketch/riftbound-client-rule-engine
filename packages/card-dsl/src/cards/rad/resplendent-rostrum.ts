import type { CardProgram } from "../../ir/index.js";

/**
 * Resplendent Rostrum (rad-046-167) — printed as a Gear (8 Energy + 1 Power,
 * Calm); the local catalog row says "Spell" (⚠ data issue, reported in the task
 * reply, not fixed here — the type lives in card-data and this program has no
 * type field).
 *
 * Printed text (catalog):
 *   :rb_exhaust:: Draw 1 and channel 1 rune exhausted.
 *   When I become exhausted, give a friendly unit +3 :rb_might: this turn.
 * ⚠ The official card prints the trigger as "When this becomes exhausted, ..."
 * (see the task reply's data-issue list); the catalog text is used verbatim here
 * because sourceText must match the local evidence.
 *
 * Rules evidence (Core Rules v1.5):
 * - ":rb_exhaust:: Draw 1 and channel 1 rune exhausted." — an Activated
 *   Ability whose entire cost is the exhaust symbol (415.3/415.3.a Limited
 *   Action paid as a cost; the merged cost planner reads `kind: 'exhaust'` as a
 *   nonstandard cost). Gear abilities default to Action timing (806/381: 在
 *   相应玩家的 Main Phase Open State). The body uses merged effect.draw and
 *   effect.channel (431.2's own example is "Channel 1 rune exhausted"), and the
 *   channel is linked to the draw because the printed "and" keeps one clause.
 * - "When I become exhausted, ..." — the merged timing point "object-exhausted"
 *   (events/timing-points.ts, CR 415.1/415.1.c) with a self-role filter; 415.2
 *   makes Exhausted a readable state, so the trigger condition is expressible.
 * - "give a friendly unit +3 :rb_might: this turn" is a temporary Might
 *   modification with an end-of-turn duration. RIFT-258 merged the card-facing
 *   `continuous.might` instruction (effects/instructions/continuous.might.ts)
 *   and the chain's ResolveContext adapter wires `addContinuous` into the layers
 *   engine (chain/engine.ts), so the grant registers a real arithmetic-layer
 *   effect and expires at turn-end (317.2.c). effect.buff covers only CR 702
 *   Buff counters and is never used as a substitute (702/703/427.1).
 *
 * Status: executable. The activated half pays its printed Exhaust cost through
 * the merged Finalize cost plan (415.4/415.5) and executes Draw 1 + channel 1
 * rune exhausted. The object-exhausted trigger (415.1) grants +3 Might this turn
 * through the merged continuous.might op. The golden test drives both halves
 * through the real ChainEngine and asserts the layered Might and its end-of-turn
 * expiry. Registering the CardProgram trigger as a production
 * TriggerRegistration remains the shared RIFT-120 wiring, recorded as test.todo
 * exactly like the merged executable trigger cards (ogn/jinx-demolitionist).
 */
const resplendentRostrum = {
  canonicalCardId: "card.hash-3fbe07d45b81cd1a97249fa165c6aa18b0f3350d24e4eaf06e090a22035f70d4",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    {
      kind: "activated",
      cost: {
        // 415.4/415.5: the leading [E] is the "Exhaust this" payment. The
        // merged cost plan accepts CostSpec.kind "activated"/"explicit"
        // (cost/plan-values.ts); "cost.activated" is rejected as unsupported.
        kind: "activated",
        payments: [{ kind: "exhaust" }]
      },
      timing: "action",
      body: [
        {
          id: "resplendent-rostrum.draw-1",
          op: "effect.draw",
          args: { amount: { kind: "constant", value: 1 } }
        },
        {
          id: "resplendent-rostrum.channel-1",
          op: "effect.channel",
          args: {
            amount: { kind: "constant", value: 1 },
            exhausted: { kind: "constant", value: true }
          },
          linkedTo: "resplendent-rostrum.draw-1"
        }
      ]
    },
    {
      kind: "triggered",
      trigger: {
        at: "object-exhausted",
        filter: { event: "object-exhausted", filter: { role: "self" } }
      },
      optional: false,
      body: [
        {
          // "give a friendly unit +3 Might this turn" — merged arithmetic-layer
          // continuous.might (RIFT-258) with an end-of-turn duration. `objects`
          // carries the Finalize-locked TargetSpec through the chain's
          // interpreter adapter; the amount is never replaced by a Buff counter
          // (702/703).
          id: "resplendent-rostrum.grant-might",
          op: "continuous.might",
          args: {
            mode: { kind: "constant", value: "add" },
            amount: { kind: "constant", value: 3 },
            duration: { kind: "constant", value: "end-of-turn" },
            objects: {
              kind: "constant",
              value: { kind: "target", id: "resplendent-rostrum.unit" }
            }
          },
          targets: [
            {
              id: "resplendent-rostrum.unit",
              filter: { type: "unit", zone: "board", controller: "self" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ],
  sourceText:
    ":rb_exhaust:: Draw 1 and channel 1 rune exhausted.\n" +
    "When I become exhausted, give a friendly unit +3 :rb_might: this turn."
} satisfies CardProgram;

export default resplendentRostrum;

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
 *   modification with an end-of-turn duration. Like the merged ogn/sfd cards
 *   (Stupefy, Punch First, Dangerous Duo, Riposte), this belongs to the layers
 *   `continuous.might` consumer: effect.buff only covers CR 702 Buff counters,
 *   and layers/ has no card-facing primitive that registers a continuous.might
 *   effect (ability-templates lists continuous.might as RIFT-91 scope).

 * Status: judge-required. The activated half's primitives are merged and the
 * golden test executes them, but the second ability is not executable (no
 * temporary-Might primitive), so the card as a whole is not executable. The
 * Might grant is recorded with the contract/layers shape and a concrete
 * judgeReason instead of being replaced by Buff counters.
 */
const resplendentRostrum = {
  canonicalCardId: "card.hash-3fbe07d45b81cd1a97249fa165c6aa18b0f3350d24e4eaf06e090a22035f70d4",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺临时 Might 修正原语：契约 3.6 的封闭 GameAction 集合没有 might 修改动作，layers/ 也没有卡牌侧入口" +
    "注册带 end-of-turn 期限的 continuous.might 持续效果（effect.buff 只覆盖 CR 702 的 Buff 指示物，" +
    "两者不可互换）。依赖：RIFT-91（layers-continuous 持续效果层）。" +
    "激活能力的 Draw 1 与 channel 1 rune exhausted 已合入并有 golden 执行证据；" +
    "「When I become exhausted」触发的对象已由 object-exhausted 时点覆盖（415.1），但触发的效果体仍缺原语；" +
    "不近似实现。",
  abilities: [
    {
      kind: "activated",
      cost: {
        kind: "cost.activated",
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
          // "give a friendly unit +3 Might this turn" — recorded with the
          // merged layers/continuous-effect shape; no registered primitive
          // consumes it yet (see judgeReason).
          id: "resplendent-rostrum.grant-might",
          op: "continuous.might",
          args: {
            amount: { kind: "constant", value: 3 },
            duration: { kind: "constant", value: "end-of-turn" }
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

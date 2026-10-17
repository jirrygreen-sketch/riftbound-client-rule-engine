import type { CardProgram } from "../../ir/index.js";

/**
 * Coalesced Energy (rad-016-167) — printed as a Unit (4 Might, 4 Energy,
 * 2 Mind Power, Shurima); the local catalog row says "Spell" (⚠ data issue,
 * reported in the task reply, not fixed here — the type lives in card-data and
 * this program has no type field).
 *
 * Printed text:
 *   At the end of your turn, recycle all your runes, then channel 4 runes
 *   exhausted.
 *
 * Rules evidence (Core Rules v1.5):
 * - 383.1: "At ... a point in time during the turn sequence" marks a Triggered
 *   Ability; the end-of-turn step is the merged timing point "turn-end"
 *   (events/timing-points.ts, CR 317.1.a). "your turn" scopes the trigger to
 *   its controller, expressed as the EventPattern player selector "self".
 * - "recycle all your runes": 417.1.b sends runes to their owner's Rune Deck;
 *   417.4 recycles as many as possible, so the amount is the current number of
 *   runes in the controller's rune zone (a `count` expression, not a stored
 *   value); 417.6 makes "Recycle X from [Zone]" a non-targeting choice, which
 *   is the merged effect.recycle `from` form (no TargetSpec).
 * - "then channel 4 runes exhausted": 431.1/431.2 channels from the top of the
 *   Rune Deck with the printed exhausted stipulation; 431.3 channels as many as
 *   possible, so a short Rune Deck is not a failure. The channel is linked to
 *   the recycle because the printed "then" makes them one ordered clause.
 *
 * Owner filter spelling: production normalizes the object-filter selectors
 * "self"/"opponent" against the ability controller (chain/engine.ts query),
 * which is the canonical spelling used by the merged keyword expansions
 * (keywords/Equip.ts, keywords/Weaponmaster.ts).
 *
 * Status: judge-required (2026-10-17 source audit).
 * turn/flow.ts emits turn-end and both printed instructions are executable.
 * The actual gap is the program translator: a player-only EventPattern can
 * match a phase event, but translateTriggerFilter inserts the default turn-end
 * event name, which is absent from EVENT_PATTERN_TYPES. controller:self cannot
 * replace player:self because phase emissions have no object to match.
 * Full-body chain tests must consume the original self count filter rather
 * than replacing it with a concrete player in the authored instructions.
 */
const coalescedEnergy = {
  canonicalCardId: "card.hash-5a4ff9de2d69584e442e29d394392ce09de6bc41ca2d52dadd0958701383a1c1",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「At the end of your turn」（CR 317.1.a）缺阶段 EventPattern 的程序绑定：turn-end 已有生产者，" +
    "但 EVENT_PATTERN_TYPES 不接受 event:turn-end；translateTriggerFilter 即使收到仅 { player:self } 也会补回该事件名，注册仍失败。" +
    "玩家过滤本身可由事件管线求值，不能再称缺 player 语义；{ controller:self } 需 event.object 而阶段事件没有，{} 则会放宽成任何玩家回合。",
  abilities: [
    {
      kind: "triggered",
      trigger: { at: "turn-end", filter: { event: "turn-end", player: "self" } },
      optional: false,
      body: [
        {
          id: "coalesced-energy.recycle-runes",
          op: "effect.recycle",
          args: {
            from: {
              kind: "constant",
              value: {
                zone: "rune-zone",
                owner: "controller",
                amount: {
                  kind: "count",
                  subject: "runes",
                  filter: { zone: "rune-zone", owner: "self" }
                }
              }
            }
          }
        },
        {
          id: "coalesced-energy.channel-4",
          op: "effect.channel",
          args: {
            amount: { kind: "constant", value: 4 },
            exhausted: { kind: "constant", value: true }
          },
          linkedTo: "coalesced-energy.recycle-runes"
        }
      ]
    }
  ],
  sourceText: "At the end of your turn, recycle all your runes, then channel 4 runes exhausted."
} satisfies CardProgram;

export default coalescedEnergy;

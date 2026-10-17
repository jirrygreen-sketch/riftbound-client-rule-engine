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
 * Status: judge-required. Both instructions are merged and the golden test runs
 * them through the real interpreter + reference kernel. The "turn-end" timing
 * point also has a merged emitter (turn/flow.ts emits it in the Ending Step
 * before cleanup, per docs/rules/timing-point-producers.md). The remaining
 * blocker is the closed EventPattern vocabulary: it has no phase-event value
 * that can express a player-filtered "turn-end" trigger, even though the
 * timing point itself is triggerable.
 */
const coalescedEnergy = {
  canonicalCardId: "card.hash-5a4ff9de2d69584e442e29d394392ce09de6bc41ca2d52dadd0958701383a1c1",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "body 两条指令（effect.recycle 的 from 形式、effect.channel exhausted）已合入并由 golden 用真实解释器 + " +
    "参考内核执行，turn-end 时点也已有发射方（src/turn/flow.ts 在 Ending Step 进入清理前 emit，CR 317.1.a）。" +
    "当前真实缺口是 EventPattern 的封闭事件词表没有阶段类事件值，validateTriggerSpec 会拒绝 event: \"turn-end\"；" +
    "因此无法同时表达 \"At the end of your turn\" 与 player: self 的订阅过滤。需要契约补充阶段时点过滤，" +
    "不近似实现。",
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

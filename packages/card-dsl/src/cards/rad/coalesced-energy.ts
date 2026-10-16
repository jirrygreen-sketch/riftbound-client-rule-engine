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
 * them through the real interpreter + reference kernel, but the trigger itself
 * cannot fire in production yet: the merged chain/events pipeline has no turn
 * driver that emits "turn-end" (the phase/turn structure is P1-3 / "批 5 Turn /
 * Combat / priority-focus" in the contract §7.2 ordering and is not merged;
 * engine-core/src/turn/ still re-exports the legacy duel modules). Until that
 * driver lands, "At the end of your turn" has no emitter, so the card is not
 * executable end-to-end and is not marked executable.
 */
const coalescedEnergy = {
  canonicalCardId: "card.hash-5a4ff9de2d69584e442e29d394392ce09de6bc41ca2d52dadd0958701383a1c1",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺回合流程的时点emit方：turn-end 已在 events/timing-points.ts 声明（CR 317.1.a），" +
    "但已合入的 chain/events 管线没有回合/阶段驱动去发出该时点（engine-core/src/turn/ 仍只再导出" +
    "旧 duel 模块；回合与阶段结构属契约 §7.2 的 P1-3「批 5 Turn / Combat / priority-focus」，" +
    "尚未合入），因此「At the end of your turn」整条触发在生产链路无法触发。" +
    "body 两条指令（effect.recycle 的 from 形式、effect.channel exhausted）已合入并由 golden " +
    "测试用真实解释器 + 参考内核执行；不近似实现。",
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

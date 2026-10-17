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
 * Status: judge-required (re-checked 2026-10-17 third re-sweep). Both
 * instructions are merged and the golden test runs them through the real
 * interpreter + reference kernel. The "turn-end" timing point also has a
 * merged emitter (turn/flow.ts emits it in the Ending Step before cleanup, per
 * docs/rules/timing-point-producers.md). The remaining blocker is the closed
 * EventPattern vocabulary: it has no phase-event value that can express
 * "At the end of your turn", even though the timing point itself is
 * triggerable (CR 317.1.a). Verified against the merged code:
 * - assertTriggerSpec({ at: "turn-end", filter: { event: "turn-end", player:
 *   "self" } }) throws "trigger.filter.event: 值必须属于 ..." — the closed list
 *   holds only object/state events (zone-entered, card-played, object-killed,
 *   attack-declared, conquered, held, scored, ...), no phase timing.
 * - The two spellings the vocabulary does accept are both wrong here:
 *   { controller: "self" } registers but never matches a phase event (the
 *   pipeline's event pattern is matched against event.object/target, and a
 *   turn-end emission carries neither), and {} matches every player's turn-end
 *   ("your turn" would become "any turn"). Neither is used.
 * The golden test asserts both facts so the gap cannot silently regress into an
 * approximated trigger.
 */
const coalescedEnergy = {
  canonicalCardId: "card.hash-5a4ff9de2d69584e442e29d394392ce09de6bc41ca2d52dadd0958701383a1c1",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "body 两条指令（effect.recycle 的 from 形式、effect.channel exhausted）已合入并由 golden 用真实解释器 + " +
    "参考内核执行，turn-end 时点也已有发射方（src/turn/flow.ts 在 Ending Step 进入清理前 emit，CR 317.1.a）。" +
    "当前真实缺口是 EventPattern 的封闭事件词表没有阶段类事件值：assertTriggerSpec 对 " +
    "filter { event: \"turn-end\", player: \"self\" } 抛 \"trigger.filter.event: 值必须属于 zone-entered, ...\"" +
    "（词表只含对象/状态事件，没有阶段时点），因此无法表达 \"At the end of your turn\" 的 player: self 订阅。" +
    "词表里可接受的两种写法都不可用：{ controller: \"self\" } 能注册但阶段事件不带 event.object/target，永不会匹配；" +
    "{} 会在任何玩家的 turn-end 触发，把 \"your turn\" 放宽成 \"any turn\"。" +
    "golden 用事件管线实测断言这两点，避免缺口被近似实现。依赖：EventPattern 的阶段时点过滤（含 player 语义）。",
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

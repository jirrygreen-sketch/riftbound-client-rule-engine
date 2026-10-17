import type { CardProgram } from "../../ir/index.js";

/**
 * Cull the Weak — ogn-209-298 (Spell, Order, 2 Energy + 1 Order Power).
 *
 * Printed text (packages/card-data/data/deck-catalog.json, ogn-209-298):
 *   Each player kills one of their units.
 *
 * Modeling notes (Core Rules v1.5):
 * - No speed keyword is printed, so the spell defaults to Action timing
 *   (159.2.a).
 * - "Each player kills one of their units" is the textbook case of 355.10.e:
 *   the object set is "chosen in whole or in part by other players", and
 *   355.18 puts that choice on resolution. The rule uses this very wording as
 *   its example — "Each player kills a unit they control" does not target —
 *   so there is no TargetSpec here: each seat chooses its own unit as the
 *   spell resolves, including the caster. That is a pick, not a target (355.7,
 *   contract 3.4), and the merged effect.kill primitive accepts a PickSpec id
 *   for exactly this case (args.picks reads ctx.picks; picks never trigger
 *   became-target effects).
 * - The interpreter has numeric repeat, but no player-roster iteration that
 *   binds each seat as the chooser of its own controlled units. A supplied
 *   pick set is not evidence of those independent resolution-time choices.
 * - "do as much as you can" (055) means a seat with no units simply kills
 *   none; 429.1 active kills of the chosen units are the normal kill action.
 *
 * Status: judge-required. The body records the single non-targeted kill with
 * the pending per-seat choice; the golden test executes the merged half (a
 * pick-driven effect.kill) with locked picks and documents the missing
 * roster-wide repetition.
 */
const cullTheWeak = {
  canonicalCardId: "card.hash-3f533cd1f26b1998b23e4537e0fd7e5c386685bf6abffe0e6e211b3f43845744",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺结算时逐玩家的 chooser 与动态非目标 PickSpec 绑定（CR 355.10.e/355.18）：" +
    "repeat 已支持数值次数，但没有遍历玩家名单、令每位玩家从自己控制的 Board 单位中恰选一个的上下文；" +
    "本卡待定 one-unit-per-player 选项及 owner:controller 过滤不能替代该流程。" +
    "须允许无可选单位的玩家不选，并把各玩家实际选择交给 effect.kill，不能只预置 picks 充当完整执行。",
  abilities: [
    {
      kind: "play",
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 2 },
        power: { kind: "constant", value: 1 }
      },
      body: [
        {
          id: "cull-the-weak.kill",
          op: "effect.kill",
          args: {
            // "one of their units" per seat: a non-target pick (355.10.e /
            // 355.18 non-targeting, 355.7 pick semantics). The per-seat count
            // (one kill for every player) stays with the pending roster-wide
            // choice (see judgeReason); the merged primitive performs the
            // picked kills it is handed.
            picks: { kind: "constant", value: "cull-the-weak.units" }
          },
          picks: [
            {
              id: "cull-the-weak.units",
              // One unit per seat, chosen on resolution: the dynamic option set
              // is each seat's own board units (355.10.e example).
              options: ["one-unit-per-player"],
              filter: { types: "unit", owner: "controller" },
              selection: "any"
            }
          ]
        }
      ]
    }
  ],
  sourceText: "Each player kills one of their units."
} satisfies CardProgram;

export default cullTheWeak;

import type { CardProgram } from "../../ir/index.js";

/**
 * Abandoned Hall (unl-205-219) — Battlefield, Colorless.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, unl-205-219, 逐字):
 *   "When a player plays a spell, they may give a unit they control here
 *    +1 :rb_might: this turn."
 *
 * CR v1.5 anchors:
 * - 383.1 / 383.4.a.4 / 383.4.b: "When a player plays a spell" is a Triggered
 *   Ability that is explicitly NOT a Play Effect (it triggers on another
 *   object being played); the closed timing point is `card-played`, whose
 *   payload carries the spell and its player (359 / 407 / 1056 uses this exact
 *   card as the example).
 * - 190.6.c: the ability names the player who played the spell as the one
 *   making the choice, so that player controls the triggered ability and makes
 *   all choices — the spell's controller, not the Battlefield's controller.
 * - 383.3.a / 383.3.e.2: "they may" is the first part of the effect, so it is
 *   decided when the ability would be finalized (declining removes it from the
 *   chain). Contract §3.9 still requires the chosen instruction to be wrapped
 *   in `choice.optional`; the ability-level `optional` flag carries the
 *   finalize decision.
 * - 355.10.c.1 / 355.7: "a unit they control here" is chosen inside the
 *   instruction, so it is a resolution-time non-target pick, not a target.
 * - 053.3 / 199 / 199.1: "here" is this Battlefield (a Location); the pick
 *   filter carries the `sameLocationAs: "self"` anchor for the source
 *   Battlefield.
 * - 143.2.a / 476 / 479.4: "+1 :rb_might: this turn" is a temporary arithmetic
 *   layer modification, not a Buff counter (effect.buff documents the same
 *   boundary: Buff is the 702/703 counter).
 *
 * Status: judge-required (re-reviewed 2026-10-17) — the body is now executable
 * on merged paths, and the remaining gap is the 190.6.c trigger binding:
 * 1. the Might grant runs for real: RIFT-258's `continuous.might` takes
 *    `objects` (not the old `pick`) and writes one arithmetic-layer registration
 *    per resolved object with the end-of-turn duration (478 / 143.2.a); the
 *    golden drives the card's own body through `runAbilityBody`, asserts the
 *    registration and the +1 effective Might through the layer engine.
 * 2. the trigger is still not honorable: RIFT-257's `registerProgramTriggers`
 *    does bind the declared pattern (golden asserts the registration), but the
 *    pipeline resolves `player: "self"` against the *ability controller*, and
 *    190.6.c makes the player who played the spell the ability's controller.
 *    No merged producer or binder re-binds the registration's controller from
 *    the `card-played` payload, so the printed choice would go to the
 *    Battlefield's controller instead of the spell's player.
 *
 * Dependencies: RIFT-257 follow-up (payload-driven event-player binding for
 * 190.6.c: the ability controller is the player named by the trigger event).
 */
export default {
  canonicalCardId: "card.hash-07b0ff2f6b2a7899316d0f3ec26470eae4923b0137b2818ab839dff113b77608",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "触发侧仍不可诚实执行，缺口只剩 190.6.c 的玩家绑定：RIFT-257 的 registerProgramTriggers 能注册本卡的 card-played 触发" +
    "（golden 断言该注册），但事件管线把 EventPattern.player 的 \"self\" 解析成**能力控制者**（pipeline-match.ts），" +
    "而 190.6.c 规定「打出该法术的玩家」才是该战场能力的控制者并做选择；没有任何已合入的生产方/binder 按 card-played 载荷" +
    "重绑注册的 controller，因此实际会把选择交给战场控制者而非法术的玩家。" +
    "已合入并以真实执行验证：RIFT-258 的 continuous.might 接受 objects 选择符并写入 arithmetic 图层 + end-of-turn 期限" +
    "（golden 用 runAbilityBody + LayerEngine 断言注册、+1 有效 Might、位置锚点与拒绝选项的 skipped 边界）；" +
    "choice.optional 与 sameLocationAs 锚点同样在执行路径上。" +
    "依赖：RIFT-257 后续（按事件载荷绑定能力控制者，实现 190.6.c）。不近似实现。",
  sourceText:
    "When a player plays a spell, they may give a unit they control here +1 :rb_might: this turn.",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "card-played",
        // 383.1/383.4.a.4: triggers on a spell being played by any player.
        // "object" is the played spell; "player" is the player who played it
        // (190.6.c), which the merged pipeline cannot yet bind to the
        // ability's controller (see judgeReason).
        filter: { event: "card-played", object: { type: "spell" }, player: "any" }
      },
      // 383.3.a/383.3.e.2: "they may" is the first part of the effect, decided
      // while finalizing the triggered ability.
      optional: true,
      body: [
        {
          id: "abandoned-hall.opt-in",
          op: "choice.optional",
          args: {
            prompt: { kind: "constant", value: "Give a unit here +1 Might this turn?" },
            body: {
              kind: "constant",
              value: [
                {
                  id: "abandoned-hall.grant-might",
                  op: "continuous.might",
                  args: {
                    amount: { kind: "constant", value: 1 },
                    duration: { kind: "constant", value: "end-of-turn" },
                    // 355.10.c.1/355.7: the unit is chosen inside the
                    // instruction — a non-target pick, not a target. RIFT-258's
                    // parameter shape reads the pick through `objects`; the
                    // pick's filter below carries the 053.3 "here" anchor.
                    objects: {
                      kind: "constant",
                      value: { kind: "pick", id: "abandoned-hall.unit-here" }
                    }
                  },
                  picks: [
                    {
                      id: "abandoned-hall.unit-here",
                      options: ["unit-controlled-by-the-spells-player-here"],
                      filter: {
                        type: "unit",
                        zone: "board",
                        // 190.6.c: the ability's controller is the player who
                        // played the spell, so "they control" is the ability
                        // controller ("self") once that binding is wired.
                        controller: "self",
                        sameLocationAs: "self"
                      },
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
  ]
} satisfies CardProgram;

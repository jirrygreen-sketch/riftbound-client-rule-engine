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
 * Status: judge-required — the printed ability cannot execute end to end, and
 * the two gaps are not approximated:
 * 1. no merged primitive registers a duration-bounded continuous Might
 *    modification: `effects/instructions/` has no `continuous.might` op and no
 *    merged caller reads a CardProgram's ability into `ctx.addContinuous`
 *    (RIFT-91 follow-up, same gap as ogn/back-to-back, ogn/lux-illuminated).
 * 2. the trigger side is an engine-wide dependency: the `card-played` timing
 *    point is really emitted by the chain (chain/engine.ts), but nothing
 *    turns a CardProgram's triggered ability into a TriggerRegistration, the
 *    `player: "self"` selector of an event pattern is resolved against the
 *    ability controller (chain context), and 190.6.c's "the player who played
 *    the spell controls the ability" binding is not wired. The `card-played`
 *    event payload does not expose the played spell's controller as the
 *    trigger's controller either.
 * The golden test executes the merged half (the non-target pick + the pick
 * filter's sameLocationAs anchor through the real interpreter) plus the target
 * shape assertions; the continuous Might and the trigger registration stay
 * `test.todo` with the task numbers.
 *
 * Dependencies: RIFT-91 follow-up (continuous.might instruction/registration
 * with an end-of-turn duration) and RIFT-120 follow-up (card-program trigger
 * registration + event-player binding for 190.6.c).
 */
export default {
  canonicalCardId: "card.hash-07b0ff2f6b2a7899316d0f3ec26470eae4923b0137b2818ab839dff113b77608",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处缺口，均不近似实现：(1) 「give a unit they control here +1 :rb_might: this turn」需要带 end-of-turn 期限的" +
    "持续 Might 修正：契约 3.6 的封闭 GameAction 没有 Might 修改动作，effects/instructions/ 没有 continuous.might op，" +
    "也没有已合入路径把 CardProgram 的 body 转成 LayerEngine 的 ContinuousEffectSpec（RIFT-91 后续；" +
    "effect.buff 文档明确临时 Might 归 layers，不用 Buff 计数器近似，CR 702/703）。" +
    "(2) 触发侧：「When a player plays a spell」按 CR 190.6.c 由**打出该法术的玩家**控制该触发能力并做选择，" +
    "但没有任何已合入订阅方把 CardProgram 的 triggered ability 注册成 TriggerRegistration；事件管线的 EventPattern.player " +
    "选择器（pipeline-match.ts 的 'self'）按能力控制者解析，而卡牌程序的能力控制者尚未按 190.6.c 绑定到事件玩家；" +
    "card-played 载荷也没有把被打出法术的控制者暴露成触发控制者。依赖：RIFT-91 后续与 RIFT-120 后续的卡牌触发注册/事件玩家绑定。" +
    "已支持部分：非目标 pick 形状与 sameLocationAs 锚点在 golden 里用真实解释器执行。",
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
                    // instruction — a non-target pick, not a target. The
                    // pick's filter below carries the 053.3 "here" anchor.
                    pick: { kind: "constant", value: "abandoned-hall.unit-here" }
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

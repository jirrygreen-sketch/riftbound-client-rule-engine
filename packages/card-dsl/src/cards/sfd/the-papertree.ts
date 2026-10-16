import type { CardProgram } from "../../ir/index.js";

/**
 * The Papertree (sfd-219-221) — Battlefield, Colorless.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, sfd-219-221):
 *   "When you hold here, each player channels 1 rune exhausted."
 *
 * CR v1.5 anchors:
 * - 383.4.d / 383.4.d.1 / 383.4.d.2.b: "When you hold here …" is a Hold
 *   Effect — a Triggered Ability; the closed hold timing point (471.2 /
 *   473.2.b) is the subscription point, and 190.6.a/190.6.d make "you" this
 *   Battlefield's Controller.
 * - 431.1 / 431.2 / 431.2.a / 431.3: Channeling takes runes from the top of a
 *   player's Rune Deck onto the Board; "exhausted" is an entry stipulation
 *   (the default is readied), and a short Rune Deck channels as many as
 *   possible without negating the instruction. effect.channel carries exactly
 *   that stipulation.
 * - "each player" is the set of all players in the game; it is a
 *   programmatic set (355.10.d, not a target) whose membership is decided by
 *   the Mode of Play, and each member each channels for themselves (431.1).
 *
 * Status: judge-required. Two merged gaps, none approximated:
 * 1. no merged module emits hold into the single event pipeline
 *    (scoring/scoring.ts returns triggerScore/triggerMethod flags that
 *    turn-executor-v2 consumes; the chain/pipeline emit sites cover only
 *    chain / card-played / showdown / cleanup / became-target), so the
 *    triggered ability cannot enter the chain. The filter's here placeholder
 *    is the 053.3 spelling the trigger-spec validator rejects
 *    (RIFT-31/RIFT-33, contract 7.2 batch 5).
 * 2. "each player channels" is a per-player iteration. The merged IR executes
 *    one body under a single ResolveContext: effect.channel reads one
 *    PlayerId (or an Expr evaluating to one — an array is negated as
 *    impossible), and the frozen opcode list has no player-set enumeration or
 *    per-seat repetition (RIFT-9's target.player / player-iteration work is
 *    unmerged; the same gap is recorded for ogn/whirlwind and
 *    ogn/obelisk-of-power). Declaring a single effect.channel would silently
 *    channel for the ability controller only, which is not what the card
 *    prints; the body below therefore carries the documented
 *    "each-player" placeholder recipient and is not executable data.
 * The channel amount and the exhausted stipulation are the merged primitive's
 * arguments, and the golden test drives that primitive for one seat (431.1 /
 * 431.2) while pinning the submitted channel-rune action; the reference test
 * kernel does not model the rune entry state, which stays a test.todo.
 */
export default {
  canonicalCardId: "card.hash-4d3a916ba4eb2379af2f90b22c56765b66af29ff69411c03a17ac2e8789cf6c0",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "Two merged gaps, none approximated. (1) The hold timing point (383.4.d / 471.2 / 473.2.b) is never emitted into the single event " +
    "pipeline: scoring/scoring.ts only returns triggerScore/triggerMethod flags for turn-executor-v2, so the trigger cannot enter the " +
    "chain (RIFT-31/RIFT-33, contract 7.2 batch 5); the filter here placeholder is the 053.3 spelling assertTriggerSpec rejects. " +
    "(2) \"each player channels 1 rune exhausted\" is a per-player iteration with no merged execution path: effect.channel reads one " +
    "PlayerId (an array evaluates to negated/impossible), the frozen opcode list has no player-set enumeration or per-seat repetition " +
    "(RIFT-9 target.player / player-iteration work is unmerged; same gap as ogn/whirlwind and ogn/obelisk-of-power), so the body carries " +
    "the documented each-player placeholder recipient instead of silently channeling for the controller only. The merged effect.channel " +
    "primitive supplies the printed amount and the exhausted entry stipulation (431.1/431.2) and is driven by the golden test for one " +
    "seat; the reference test kernel does not model the rune entry state (test.todo).",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "hold",
        // "here" is this Battlefield (053.3) and "you" its Controller
        // (190.6.d); sibling battlefield programs keep the same placeholder
        // spelling while the hold pipeline is unmerged.
        filter: { event: "hold", here: true, player: "controller" }
      },
      optional: false,
      body: [
        {
          // "each player channels 1 rune exhausted" (431.1/431.2). The
          // recipient is the whole player set, which the frozen IR cannot
          // name: the constant below is a documented placeholder for the
          // missing per-seat iteration, not a fabricated seat.
          id: "the-papertree.channel-1-rune",
          op: "effect.channel",
          args: {
            player: { kind: "constant", value: "each-player" },
            amount: { kind: "constant", value: 1 },
            exhausted: { kind: "constant", value: true }
          }
        }
      ]
    }
  ],
  sourceText: "When you hold here, each player channels 1 rune exhausted."
} satisfies CardProgram;

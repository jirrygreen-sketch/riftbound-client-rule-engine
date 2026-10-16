import type { CardProgram } from "../../ir/index.js";

/**
 * Mobilize (ogn-134-298) — Spell, 2 energy, Body.
 *
 * Printed text:
 *   Channel 1 rune exhausted. If you can't, draw 1.
 *
 * Modeling notes (Core Rules v1.5):
 * - "Channel 1 rune exhausted" is the merged effect.channel primitive
 *   (431.1 / 431.2 / 431.4.b) with amount 1 and the printed exhausted
 *   stipulation (431.2: the rune enters the board exhausted rather than
 *   ready); the stipulation is passed through to the channel-rune GameAction.
 * - 431.3: with an insufficient Rune Deck the spell channels as many runes as
 *   possible and the shortfall is not a failure. effect.channel links the
 *   actual channeled count as "channeled" for exactly this follow-up (431.5
 *   prints this card's channel-plus-fallback phrasing as its example).
 * - "If you can't, draw 1." is a per-instruction condition clause (contract
 *   3.4: a condition's scope is the instruction that owns it) comparing that
 *   linked actual count against 1; the draw is a plain effect.draw (414.3).
 *   It is deliberately not linkedTo the channel instruction: a failed channel
 *   must not suppress the independent draw.
 * - No speed keyword is printed, so no keyword ability is declared; spells
 *   default to Action timing (159.2.a).
 */
const mobilize = {
  canonicalCardId: "card.hash-8b937ea127c7d610d6f502d591b666c7cf2eab805964c7a5a049f74066a969f1",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    {
      kind: "play",
      body: [
        {
          id: "mobilize.channel-rune",
          op: "effect.channel",
          args: {
            amount: { kind: "constant", value: 1 },
            exhausted: { kind: "constant", value: true }
          }
        },
        {
          id: "mobilize.draw-if-cant",
          op: "effect.draw",
          args: { amount: { kind: "constant", value: 1 } },
          condition: {
            kind: "compare",
            left: {
              kind: "linked-value",
              instructionId: "mobilize.channel-rune",
              key: "channeled"
            },
            operator: "lt",
            right: { kind: "constant", value: 1 }
          }
        }
      ]
    }
  ],
  sourceText: "Channel 1 rune exhausted. If you can't, draw 1."
} satisfies CardProgram;

export default mobilize;


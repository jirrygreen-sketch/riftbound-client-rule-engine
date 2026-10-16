import type { CardProgram } from "../../ir/index.js";

/**
 * Catalyst of Aeons (ogn-138-298) — Spell, 4 energy, Body.
 *
 * Printed text:
 *   Channel 2 runes exhausted. If you couldn't channel 2 runes this way,
 *   draw 1.
 *
 * Modeling notes (Core Rules v1.5):
 * - "Channel 2 runes exhausted" is the merged effect.channel primitive
 *   (431.1 / 431.2 / 431.4.b) with amount 2 and the printed exhausted
 *   stipulation (431.2).
 * - 431.3: a short Rune Deck channels as many runes as possible and the actual
 *   count is linked as "channeled" (431.5 prints this exact wording as its
 *   example for that follow-up). 431.2.a: channeling zero runes is not a
 *   failure, so an empty Rune Deck still links 0 instead of negating.
 * - "If you couldn't channel 2 runes this way, draw 1." is a per-instruction
 *   condition (contract 3.4) comparing the linked actual count against 2; the
 *   draw is a plain effect.draw (414.3) and is not linkedTo the channel, so a
 *   shortfall still resolves it.
 * - No speed keyword is printed; spells default to Action timing (159.2.a).
 */
const catalystOfAeons = {
  canonicalCardId: "card.hash-d410ba7cd93c0eaef1fc5e938a2ed48f4779279e1906ab9badcbe60658cfec1b",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    {
      kind: "play",
      body: [
        {
          id: "catalyst-of-aeons.channel-runes",
          op: "effect.channel",
          args: {
            amount: { kind: "constant", value: 2 },
            exhausted: { kind: "constant", value: true }
          }
        },
        {
          id: "catalyst-of-aeons.draw-if-short",
          op: "effect.draw",
          args: { amount: { kind: "constant", value: 1 } },
          condition: {
            kind: "compare",
            left: {
              kind: "linked-value",
              instructionId: "catalyst-of-aeons.channel-runes",
              key: "channeled"
            },
            operator: "lt",
            right: { kind: "constant", value: 2 }
          }
        }
      ]
    }
  ],
  sourceText:
    "Channel 2 runes exhausted. If you couldn't channel 2 runes this way, draw 1."
} satisfies CardProgram;

export default catalystOfAeons;


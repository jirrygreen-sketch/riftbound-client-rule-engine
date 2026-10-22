import type { CardProgram } from "../../ir/index.js";

/**
 * Frigid Touch — sfd-066-221 (Spell, Mind, Rumble SFD champion precon).
 *
 * Printed text:
 *   [Reaction] (Play any time, even before spells and abilities resolve.)
 *   [Repeat] [2] (You may pay the additional cost to repeat this spell's effect.)
 *   Give a unit -2 [M] this turn.
 *
 * Modeling notes (Core Rules v1.5):
 * - [Reaction] (813) is a keyword ability expanded by the keyword registry.
 * - [Repeat] [2] (820) is an Optional Additional Cost keyword: 820.1.d makes
 *   the paid instance execute the spell's instructions one additional time
 *   during resolution, with choices re-made (820.2 / 820.2.a). The 2-energy
 *   optional additional cost is declared on the play CostSpec (contract 3.1).
 *   The production resolver reads the exact paid instance ids from the frozen
 *   cost plan/receipt and repeats this body; the card does not write a fixed
 *   repeat count or carry an effect.repeat action template as a substitute.
 * - "Give a unit -2 [M] this turn" is a temporary Might modification executed
 *   by the merged continuous.might primitive (RIFT-258): contract 3.4's
 *   arithmetic layer and end-of-turn duration. The body can therefore be
 *   repeated directly without translating -2 Might into Buff counters.
 *
 * status 判定（cards/README.md 第 2 节）：executable。RIFT-952 / a4712989
 * landed the paid-instance lifecycle removed by the earlier RIFT-364 gap: each
 * execution owns an independent Finalize target lock (repeatIndex 0..N), Resolve
 * binds the body to its own lock, and revalidates that lock independently. The
 * production goldens cover decline, a different target for each execution, the
 * same target twice, Reaction timing, and a target that becomes stale after
 * Finalize. The card therefore keeps one faithful body and adds no fabricated
 * target choice or Buff-based Might substitute.
 */
const frigidTouch = {
  canonicalCardId: "card.hash-153eb4df721b70662a63652ba1602985ceed08d81a0b23fc0d6b10349ee15ca9",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    { kind: "keyword", keyword: "reaction" },
    { kind: "keyword", keyword: "repeat" },
    {
      kind: "play",
      cost: {
        kind: "additional",
        payments: [
          {
            kind: "energy",
            amount: { kind: "constant", value: 2 },
            choice: {
              id: "repeat-payment",
              options: ["pay", "decline"],
              selection: "one"
            }
          }
        ]
      },
      body: [
        {
          id: "give-minus-2-might",
          op: "continuous.might",
          args: {
            amount: { kind: "constant", value: -2 },
            duration: { kind: "constant", value: "this-turn" },
            // 契约 3.6：作用对象经 objects 描述符指向 Finalize 锁定的 TargetSpec。
            // CR 820.2.a 的重选仍由引擎的额外执行生命周期承担。
            objects: {
              kind: "constant",
              value: { kind: "target", id: "affected-unit" }
            }
          },
          targets: [
            {
              id: "affected-unit",
              // CR 355.9.a.1: an unqualified "unit" is an object on the Board.
              filter: { type: "unit", zone: "board" },
              selection: "one"
            }
          ]
        }
      ]
    }
  ],
  sourceText:
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "[Repeat] :rb_energy_2: (You may pay the additional cost to repeat this spell's effect.)\n" +
    "Give a unit -2 :rb_might: this turn."
} satisfies CardProgram;

export default frigidTouch;

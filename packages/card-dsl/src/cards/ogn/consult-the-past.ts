import type { CardProgram } from "../../ir/index.js";

/**
 * Consult the Past — ogn-083-298 (Spell, Mind, Rumble SFD champion precon).
 *
 * Printed text:
 *   [Hidden] (Hide now for [A] to react with later for [0].)
 *   [Reaction] (Play any time, even before spells and abilities resolve.)
 *   Draw 2.
 *
 * Modeling notes (Core Rules v1.5):
 * - [Hidden] (811) and [Reaction] (813) are declared as keyword abilities and
 *   expanded by the keyword registry (contract 3.7). Hidden's expansion
 *   (RIFT-84) grants the Hide discretionary action plus the facedown play
 *   permission; Reaction's expansion (RIFT-85, merged) is the
 *   continuous.timing static granting Closed State play.
 * - "Draw 2." is a plain instruction effect: a single effect.draw primitive
 *   (CR 414.3 "Draw X."; amount evaluated at resolution per contract 3.6).
 *   No target, pick, or choice is involved; the implicit drawer is the
 *   ability controller (CR 190.6.d), which is effect.draw's default.
 */
const consultThePast = {
  canonicalCardId: "card.hash-2ebf1fe6e5ed7bb875f1c112b3e0ed1635b557c0c0ad550d752b8dd376243007",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    { kind: "keyword", keyword: "hidden" },
    { kind: "keyword", keyword: "reaction" },
    {
      kind: "play",
      body: [
        {
          id: "draw-2",
          op: "effect.draw",
          args: { amount: { kind: "constant", value: 2 } }
        }
      ]
    }
  ],
  sourceText:
    "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "Draw 2."
} satisfies CardProgram;

export default consultThePast;

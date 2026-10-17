import type { CardProgram } from "../../ir/index.js";

/**
 * Bonds of Strength (sfd-151-221) — Spell, 2 energy, no printed power, Order.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, sfd-151-221, verbatim):
 *   "[Reaction] (Play any time, even before spells and abilities resolve.)
 *    [Repeat] :rb_energy_2: (You may pay the additional cost to repeat this
 *    spell's effect.)
 *    Give two friendly units each +1 :rb_might: this turn."
 *
 * Rules evidence (Core Rules v1.5):
 * - "[Reaction]" (813.1.b/813.1.c) is declared only; the registry expands the
 *   permission (contract 3.7) and the chain decides admission.
 * - "two friendly units" is one target group of exactly two units the controller
 *   controls (355.9.b's "unit you control"): the printed count is fixed, so
 *   min 2 / max 2 rather than "up to" (355.13 would allow zero), and Finalize
 *   rejects the play when fewer than two friendly units exist (355.8). The
 *   shape and the bounds are identical to the merged ogn/back-to-back.
 * - "each +1 :rb_might: this turn" is a temporary Might modification that
 *   expires in the end-of-turn cleanup (317.2.c; 143.2.a's Effective Might is
 *   what card text reads). It is an arithmetic-layer continuous effect
 *   (478/478.1.a), registered by the merged continuous.might instruction
 *   primitive (RIFT-258) through ctx.addContinuous with the printed end-of-turn
 *   duration. effect.buff's own header states temporary Might changes "belong
 *   to continuous.might, never to this primitive", and 703 makes a Buff counter
 *   a distinct object, so no Buff substitution is authored.
 * - The two clauses are independent sentences, so no instruction is linked to
 *   the other. "each" is carried by the fixed two-unit target group: the one
 *   instruction registers one continuous effect per selected unit, which is
 *   exactly "each of the two gain +1".
 */
const bondsOfStrength = {
  canonicalCardId: "card.hash-13ba5efe94e7668b6570b551c230fecd5395f082448d8a86f0ba8b2f23b78626",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    { kind: "keyword", keyword: "reaction" },
    {
      kind: "play",
      body: [
        {
          // "Give two friendly units each +1 :rb_might: this turn": one
          // arithmetic-layer registration per locked unit, expiring at the
          // end of the turn (478.1.a / 317.2.c). The locked target group is
          // read through continuous.might's objects argument (契约 3.6 的符号
          // 选择器：IR 不写运行时 ObjectRef).
          id: "bonds-of-strength.grant-might",
          op: "continuous.might",
          args: {
            amount: { kind: "constant", value: 1 },
            duration: { kind: "constant", value: "this-turn" },
            objects: {
              kind: "constant",
              value: { kind: "target", id: "bonds-of-strength.units" }
            }
          },
          targets: [
            {
              id: "bonds-of-strength.units",
              // 固定两个由本能力控制者控制的单位（355.9.b）；不是 up to（355.13）。
              filter: { type: "unit", zone: "board", controller: "self" },
              min: 2,
              max: 2,
              selection: "any"
            }
          ]
        }
      ]
    }
  ],
  sourceText:
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "[Repeat] :rb_energy_2: (You may pay the additional cost to repeat this spell's effect.)\n" +
    "Give two friendly units each +1 :rb_might: this turn."
} satisfies CardProgram;

export default bondsOfStrength;

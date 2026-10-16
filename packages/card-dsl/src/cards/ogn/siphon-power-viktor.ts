import type { CardProgram } from "../../ir/index.js";

/**
 * Siphon Power, Viktor (ogn-266-298) — Spell, 2 energy + 1 Mind power
 * (Mind/Order, Viktor Signature).
 *
 * Printed text:
 *   [Reaction] (Play any time, even before spells and abilities resolve.)
 *   Choose a battlefield. Give friendly units there +1 :rb_might: this turn
 *   and enemy units there -1 :rb_might: this turn, to a minimum of 1
 *   :rb_might:.
 *
 * Modeling notes (Core Rules v1.5):
 * - [Reaction] (813) is declared as a keyword ability; the keyword registry
 *   owns its expansion (contract 3.7). Admission is chain-owned (canAct plus
 *   the draft's speed), not per-card behaviour.
 * - "Choose a battlefield" chooses a Zone to affect, so it is a Choice and a
 *   target (355.5 / 355.7 / 355.9.a: a valid target is "a player or zone";
 *   355.10.b prints "Kill all units at a battlefield" as the example that
 *   targets the battlefield and not the units). A battlefield is a Board Game
 *   Object whose location is itself, so the TargetSpec selects it from the
 *   Board and the unit sets anchor on it with sameLocationAs.
 * - "friendly units there" / "enemy units there" are programmatic sets chosen
 *   by criteria, not targets (355.10.d / 355.10.d.1: no choice over the units
 *   is ever possible). They are authored as the non-target `{ kind: "query",
 *   filter }` set form the continuous.might primitive consumes ("objects"),
 *   grouped by the spell controller's perspective. The query's controller is
 *   evaluated relative to the ability's controller.
 * - "+1 Might this turn" / "-1 Might this turn" are temporary Might
 *   modifications executed by the merged continuous.might primitive (RIFT-258):
 *   it registers one arithmetic-layer effect per resolved object through
 *   ResolveContext.addContinuous with the end-of-turn duration
 *   (317.1.a / 468.7.c, layers/ops resolveContinuousDuration).
 * - "to a minimum of 1 [M]" is the printed limitation on the decrease. CR
 *   479.4.b snapshots it at application time; the primitive carries it as
 *   effect.minimum and snaps the delta against the target's current Might, so
 *   a 2-Might unit given -1 ends at 1 and a 1-Might unit is left at 1.
 * - 478.1.c's official Siphon Power example (two mutually referencing 4-Might
 *   units end at 4 each) is a layers dependency-loop property that lives with
 *   the layers engine, not with this card's data.
 *
 * Status: executable — the whole printed ability executes on merged paths and
 * the golden test drives the card's own body through the production chain
 * adapter, asserting the registered arithmetic-layer effects, the
 * friendly/enemy same-location grouping, the printed minimum, the end-of-turn
 * expiry, and the mistargeted edge.
 */
const siphonPower = {
  canonicalCardId: "card.hash-d619150ac39f656ea38c332ad3a03989be755c3114becae61bb346ae3996951d",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    { kind: "keyword", keyword: "reaction" },
    {
      kind: "play",
      body: [
        {
          id: "grant-plus-1-to-friendly-units",
          // "friendly units there +1 Might this turn" — a duration-bounded
          // Might modification over the programmatic set of friendly units at
          // the chosen battlefield. Not a target set (355.10.d).
          op: "continuous.might",
          args: {
            amount: { kind: "constant", value: 1 },
            duration: { kind: "constant", value: "this-turn" },
            objects: {
              kind: "constant",
              value: {
                kind: "query",
                filter: {
                  type: "unit",
                  zone: "board",
                  controller: "self",
                  sameLocationAs: { target: "chosen-battlefield" }
                }
              }
            }
          },
          // "Choose a battlefield": the affected Zone is chosen while making
          // the spell's relevant choices (355.5 / 355.7 / 355.9.a), so it is a
          // target. The unit sets anchor on this spec with sameLocationAs.
          targets: [
            {
              id: "chosen-battlefield",
              filter: { type: "battlefield" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          id: "grant-minus-1-to-enemy-units",
          // "enemy units there -1 Might this turn, to a minimum of 1" — the
          // decrease carries the printed limit, which 479.4.b snapshots at
          // application time (the merged primitive writes effect.minimum).
          op: "continuous.might",
          args: {
            amount: { kind: "constant", value: -1 },
            duration: { kind: "constant", value: "this-turn" },
            minimum: { kind: "constant", value: 1 },
            objects: {
              kind: "constant",
              value: {
                kind: "query",
                filter: {
                  type: "unit",
                  zone: "board",
                  controller: "opponent",
                  sameLocationAs: { target: "chosen-battlefield" }
                }
              }
            }
          }
        }
      ]
    }
  ],
  sourceText:
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "Choose a battlefield. Give friendly units there +1 :rb_might: this turn and enemy units there " +
    "-1 :rb_might: this turn, to a minimum of 1 :rb_might:."
} satisfies CardProgram;

export default siphonPower;

import type { CardProgram } from "../../ir/index.js";

/**
 * Decisive Strike, Garen (ogs-024-024) — Spell, 5 energy + 1 Order power
 * (Body/Order), tags Garen/Signature.
 *
 * Printed text:
 *   [Action] (Play on your turn or in showdowns.)
 *   Give friendly units +2 :rb_might: this turn.
 *
 * Modeling notes (Core Rules v1.5):
 * - [Action] (806) is declared as a keyword ability; the registry owns the
 *   Showdown permission (806.1.b/806.1.c, 159.2.a).
 * - "friendly units" is an unfiltered set of every unit the controller
 *   controls: no choice is ever made, so the units are not Targeted
 *   (355.10.d, 355.10.d.1 - the rule's own example is "Kill all units at
 *   battlefields", which targets nothing). The set is therefore declared with
 *   the resolve-time query descriptor shape merged primitives use, while
 *   "this turn" fixes the duration as the end of the turn.
 * - "+2 [M] this turn" is a temporary Might modification, not a Buff counter
 *   (702: a Buff counter is a distinct object that contributes +1 Might; it is
 *   not a Might value change).
 *
 * Status: executable — the merged continuous.might primitive (RIFT-258)
 * registers one arithmetic-layer effect per resolved object through
 * ResolveContext.addContinuous with the end-of-turn duration (317.1.a /
 * 468.7.c), so the whole printed ability executes. The friendly units are a
 * programmatic non-target set (355.10.d / 355.10.d.1) consumed through the
 * primitive's `objects: { kind: "query" }` form; the golden test drives the
 * card's own body through the production chain adapter and asserts the real
 * registrations, the end-of-turn expiry and the empty-set boundary. Using
 * effect.buff instead would place Buff counters (CR 702) and is never done.
 */
const decisiveStrikeGaren = {
  canonicalCardId: "card.hash-8ede68abdc12ce7e49e3fb3df89263c308b4405bac8deb070fc67b27cf1b3a30",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 5 },
        power: { kind: "constant", value: 1 }
      },
      body: [
        {
          // "Give friendly units +2 [M] this turn" — the merged
          // continuous.might primitive registers one arithmetic-layer effect
          // per matching object with the end-of-turn duration. The units are a
          // programmatic set, not targets (355.10.d), so the instruction
          // declares no TargetSpec; "self" is bound to the ability controller
          // by the chain's Finalize/query wrapper (chain/engine.ts).
          id: "decisive-strike-garen.grant-plus-2-might",
          op: "continuous.might",
          args: {
            amount: { kind: "constant", value: 2 },
            duration: { kind: "constant", value: "end-of-turn" },
            objects: {
              kind: "constant",
              value: {
                kind: "query",
                filter: { type: "unit", controller: "self" }
              }
            }
          }
        }
      ]
    }
  ],
  sourceText:
    "[Action] (Play on your turn or in showdowns.)\n" +
    "Give friendly units +2 :rb_might: this turn."
} satisfies CardProgram;

export default decisiveStrikeGaren;

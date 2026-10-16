import type { CardProgram } from "../../ir/index.js";

/**
 * Rally for War (rad-007-167) — Gear, 3 Energy + 1 Fury Power, no tags.
 *
 * Printed text (deck-catalog.json, rad-007-167, verbatim):
 *   Choose an occupied enemy battlefield. Play three 1 :rb_might: Recruit unit
 *   tokens there.
 *
 * Rules evidence (Core Rules v1.5):
 * - 170 / 199 / 199.1 / 170.7: a Battlefield is a Game Object that is also a
 *   Location, so it can be the object of a choice. 170.11.a defines “occupied”
 *   (it has a Unit present); “enemy” means a Battlefield controlled by an
 *   opponent (190.2.b). 355.7 / 355.9.a / 355.10.b name this exact shape: the
 *   Battlefield itself is the object being chosen and affected, while
 *   “occupied” and “enemy” are targeting restrictions, not extra targets.
 * - Contract §3.6 ObjectSelector: the second instruction refers to the chosen
 *   Battlefield through `{ target: ... }`, so the finished choice is locked at
 *   Finalize and rechecked at resolution (355.8, 359.3.e).
 * - 187.1: a 1 [M] Recruit token is a domainless unit token with 1 Might and
 *   the Recruit tag — the frozen `recruit` entry in effect.token's DEFINITIONS
 *   table is exactly this printing, so no token statistics are invented here.
 * - 350.2 / 440.2.c / 185.2.a: the printed instruction says “Play … tokens”,
 *   so the tokens are created on the Chain and the chain's play flow takes
 *   them over at the chosen Location (effect.token `mode: "play"` with the
 *   target-supplied destination). “there” is the chosen Battlefield, which
 *   effect.token reads from the surviving target's Location (198.2 / 199.1).
 * - 359.2.b: a Permanent executes all of its rules text from top to bottom, so
 *   the printed instruction is this Gear's play ability body.
 *
 * Status: executable — the Finalize TargetPlan locks the one chosen
 * Battlefield, and the merged effect.token primitive performs the three Chain
 * creations plus the plays at that Location. The golden test executes the
 * card's own instruction through the reference kernel and asserts the real
 * create/play events and the resulting board objects.
 *
 * Judged parts are outside this card's data and are recorded as TODOs in the
 * golden test: the production filter vocabulary has no “occupied”/“enemy
 * battlefield” predicate yet (ObjectFilter spells the controller restriction
 * as a PlayerSelector and has no occupancy key), and the CardProgram ->
 * ChainDraft `describePlay` adapter is the RIFT-120 follow-up.
 */
const rallyForWar = {
  canonicalCardId: "card.hash-14ade9eb01b57e1602425dda41e17e436ad9e8e9e597748e0d5d0fd42ac1cb66",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    {
      kind: "play",
      body: [
        {
          // “Play three 1 :rb_might: Recruit unit tokens there.” 187.1 fixes
          // the token; 440.2.c / 185.2.a route the play through the Chain and
          // 198.2/199.1 supply “there” from the chosen Battlefield's Location.
          id: "rally-for-war.recruits",
          op: "effect.token",
          args: {
            token: { kind: "constant", value: "recruit" },
            amount: { kind: "constant", value: 3 },
            mode: { kind: "constant", value: "play" },
            target: { kind: "constant", value: "rally-for-war.battlefield" },
            linkKey: { kind: "constant", value: "recruitTokens" }
          },
          targets: [
            {
              // “an occupied enemy battlefield” (170.11.a + 190.2.b). The
              // occupancy/controller restrictions are carried by the filter;
              // “enemy” uses the frozen PlayerSelector spelling `opponent`
              // (layers/filter.ts selectorMatches).
              id: "rally-for-war.battlefield",
              filter: {
                type: "battlefield",
                controller: "opponent",
                occupied: true
              },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ],
  sourceText:
    "Choose an occupied enemy battlefield. Play three 1 :rb_might: Recruit unit tokens there."
} satisfies CardProgram;

export default rallyForWar;

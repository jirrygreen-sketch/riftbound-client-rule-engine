import type { CardProgram } from "../../ir/index.js";

/**
 * Bounty Hunter (ogn-267-298) — Legend, Body/Chaos, tag Miss Fortune.
 *
 * Printed text:
 *   :rb_exhaust:: Give a unit [Ganking] this turn. (It can move from
 *   battlefield to battlefield.)
 *
 * Structure (contract 3.1/3.2):
 * - activated ability, action timing (default; CR 376), cost = exhaust this
 *   legend (CR 415.5);
 * - "a unit" is a target (CR 355.5, 355.9.a.1: a Board unit; no controller
 *   restriction, so any unit on the Board is legal);
 * - "give a unit [Ganking] this turn" grants the Ganking keyword (CR 810;
 *   KeywordDef stacking "single") with an end-of-turn duration (CR 317.2.c).
 *
 * Status: executable — the merged continuous.grant-keyword instruction
 * registers the grant, describeActivate binds the exhaust cost and target
 * Finalize, and the merged KeywordGrantLayerEngine re-expands the dynamically
 * granted Ganking into the battlefield-to-battlefield movement permission,
 * revoking it at turn end. The golden test drives the real production chain
 * (Exhaust payment, locked target, chain resolution) and asserts the
 * movement() permission before and after expiry (CR 810.1.c).
 */
const program = {
  canonicalCardId:
    "card.hash-c26c4c53932bf73803251e7f0e60d3d3f8c1995783f4e6451d025fc6099f5ff6",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    {
      kind: "activated",
      timing: "action",
      cost: { payments: [{ kind: "exhaust" }] },
      body: [
        {
          id: "bounty-hunter.grant-ganking",
          op: "continuous.grant-keyword",
          args: {
            objects: { kind: "constant", value: { kind: "target", id: "bounty-hunter.unit" } },
            keyword: { kind: "constant", value: "Ganking" },
            duration: { kind: "constant", value: "end-of-turn" }
          },
          targets: [
            {
              id: "bounty-hunter.unit",
              filter: { type: "unit", zone: "board" },
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
    ":rb_exhaust:: Give a unit [Ganking] this turn. (It can move from battlefield to battlefield.)"
} satisfies CardProgram;

export default program;

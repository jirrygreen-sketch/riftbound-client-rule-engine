import type { CardProgram } from "../../ir/index.js";

/**
 * Master Yi, Honed (ogs-009-024).
 * CR v1.5 810.1.b/810.1.c and 144.4.c.1: Ganking adds the battlefield-to-
 * battlefield Standard Move permission; only the engine expands the keyword.
 * The keyword's string permission is still incompatible with the movement
 * query's { routes: [...] } input, so the whole card remains judge-required.
 * The enter-ready replacement (143.4, 359.2.c, 369.3) has real entry evidence;
 * it rewrites entry rather than readying an already entered unit.
 * RIFT-700 rechecks the unchanged IR against the catalog and CR v1.5; the
 * template golden covers paid entry and the self-only replacement boundary.
 */
export default {
  canonicalCardId: "card.hash-65cd9565fff10c8779998a9b1ca3843ab54b34a3cc338af891157cfbf9ec1761",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "Ganking (CR 810.1.c/144.4.c.1): effects/keywords/Ganking.ts emits permission as the string \"battlefield-to-battlefield\", but layers/rules/query.ts movement() consumes a {routes:[...]} object. The keyword static therefore grants no query.canGank permission for moveDuelUnitsStandard. Contract change request: normalize the keyword permission and movement query to one shape.",
  abilities: [
    { kind: "keyword", keyword: "ganking" },
    {
      kind: "replacement",
      replaces: {
        event: "object-enters-board",
        filter: { self: true, exhausted: true }
      },
      with: [
        {
          id: "master-yi-honed.enter-ready",
          op: "effect.ready",
          args: {
            objects: { kind: "constant", value: { kind: "source" } }
          }
        }
      ]
    }
  ],
  sourceText: "[Ganking] (I can move from battlefield to battlefield.)\nI enter ready."
} satisfies CardProgram;

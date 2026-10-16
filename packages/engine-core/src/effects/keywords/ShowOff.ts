import type { Ability, Value } from "@riftbound/card-dsl";

import type { CardContextRef, KeywordDef } from "../keyword-contract.js";

/**
 * [Show Off] [Object] — passive keyword expansion (Core Rules v1.5 §832).
 *
 * Show Off is a Finalize-time optional choice, so the keyword expands to the
 * static `cost.reveal` declaration consumed by the chain/cost pipeline.  The
 * keyword does not choose objects, reveal cards, or lock snapshots itself.
 * `object` is supplied by the card compiler as the printed Object clause; the
 * current KeywordDef contract does not yet expose that parameter, so the
 * expansion records `null` until the v1.1 params extension is wired through.
 *
 * Dependencies not yet merged (the expansion deliberately keeps these
 * contract shapes instead of approximating them):
 * - `cost.reveal` / the Finalize choice and legality pipeline (RIFT-261) must
 *   allow the controller to reveal from hand and/or pick friendly Board
 *   objects, and must keep the selected set valid if an object later leaves a
 *   zone (§832.1.c–c.4).
 * - The `objects-shown-off` timing point and chain link/snapshot consumer must
 *   capture the selected object references and the characteristic snapshots at
 *   Finalize (§832.1.c.1, §832.1.d–d.1).
 * - `condition.result` must expose the per-instance linked result to later
 *   abilities/instructions.  Multiple Show Off instances stay independent
 *   (§832.2–2.a); they must not be merged into one boolean.
 * - `KeywordDef.expand` currently lacks the printed Object/instance parameter.
 *   The optional `params` read below is forward-compatible, but callers using
 *   the frozen interface cannot provide it yet.  This is a contract change
 *   request, not an invented default object filter.
 */

const SHOW_OFF_RULE_REFS = [
  "832",
  "832.1",
  "832.1.a",
  "832.1.b",
  "832.1.b.1",
  "832.1.c",
  "832.1.c.1",
  "832.1.c.2",
  "832.1.c.3",
  "832.1.c.4",
  "832.1.d",
  "832.1.d.1",
  "832.2",
  "832.2.a",
  "832.3"
] as const;

export interface ShowOffParams extends Readonly<Record<string, Value | undefined>> {
  readonly object?: Value;
  readonly instanceId?: string;
}

export interface ShowOffInput {
  readonly value?: number;
  readonly host: CardContextRef;
  readonly params?: ShowOffParams;
}

const showOff = {
  keyword: "Show Off",
  // §832.1.b's Object clause is a set/filter, not a numeric keyword value.
  valued: false,
  // §832.2: each instance has its own linked result and snapshot.
  stacking: "separate",
  expand(input: ShowOffInput): readonly Ability[] {
    const params = input.params;
    // Without the params extension the compiler cannot provide a stable
    // per-instance id.  Keep an explicit pending marker rather than silently
    // merging two Show Off instances from the same source.
    const instanceId = params?.instanceId ?? `show-off:${input.host.canonicalCardId}:pending`;
    const ability: Ability = {
      kind: "static",
      effect: {
        kind: "cost.reveal",
        instanceId,
        appliesTo: "self",
        chooser: "controller",
        timing: "chain-item-finalize",
        optional: true,
        sources: ["hand", "board"],
        handAction: "reveal",
        boardAction: "pick",
        object: params?.object ?? null,
        result: {
          kind: "show-off",
          instanceId,
          link: `show-off:${instanceId}`,
          lockAt: "objects-shown-off",
          snapshot: true
        },
        ruleRefs: [...SHOW_OFF_RULE_REFS]
      }
    };
    return Object.freeze([ability]);
  },
  ruleRefs: SHOW_OFF_RULE_REFS
} satisfies KeywordDef;

export default showOff as KeywordDef;

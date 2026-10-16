/**
 * Temporary —— v1.5 规则 816。
 *
 * Temporary is a triggered keyword on permanents. It expands to one mandatory
 * trigger at the start of the host controller's Beginning Phase, before
 * scoring, whose body uses the merged `effect.kill` primitive to kill the
 * host. Multiple instances are redundant (816.2), so the keyword is single
 * stacking and ignores any stray numeric input.
 *
 * Dependencies not yet merged:
 * - Keyword ability registration into the event/chain pipeline must subscribe
 *   this expansion to `beginning-start` and enqueue the pending trigger.
 * - The turn-flow emitter must publish the controller's Beginning Phase start
 *   before the scoring step. The timing point itself is already declared.
 *
 * `effect.kill` is already merged and is used directly; this definition does
 * not duplicate game flow or implement a private kill path.
 */
import type { Ability, Instruction } from "@riftbound/card-dsl";

import type { CardContextRef, KeywordDef } from "../keyword-contract.js";

function expand({ host }: { readonly value?: number; readonly host: CardContextRef }): readonly Ability[] {
  const kill: Instruction = {
    id: `temporary:${host.canonicalCardId}:kill`,
    op: "effect.kill",
    args: { self: { kind: "constant", value: true } }
  };

  return [{
    kind: "triggered",
    trigger: {
      at: "beginning-start",
      filter: { event: "beginning-start", player: "self" }
    },
    optional: false,
    body: [kill]
  }];
}

const temporary = {
  keyword: "Temporary",
  valued: false,
  stacking: "single",
  expand,
  ruleRefs: ["816", "816.1", "816.1.a", "816.1.b", "816.1.c", "816.2", "816.2.a", "816.3"]
} satisfies KeywordDef;

export default temporary;

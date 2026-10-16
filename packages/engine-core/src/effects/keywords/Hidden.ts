import type { Ability } from "@riftbound/card-dsl";
import type { KeywordDef } from "../keyword-contract.js";

/**
 * Hidden (Core Rules v1.5, 811) expands to the static hidden-cost effect.
 *
 * Dependencies not yet merged:
 * - `cost.hidden` for the Hide action, facedown-zone restrictions, and free
 *   play from the facedown zone (RIFT-89).
 * - `cost.pay` and `effect.zone` for the [A] payment and Hide movement
 *   (RIFT-89).
 * - `continuous.timing` for the Reaction permission beginning next turn
 *   (RIFT-91).
 *
 * This file only declares the EffectIR expansion. Hidden-card choices and
 * facedown information remain owned by the cost, zone, timing, and chain
 * implementations.
 */
const Hidden = {
  keyword: "Hidden",
  valued: false,
  stacking: "single",
  ruleRefs: [
    "811.1",
    "811.1.a",
    "811.1.b",
    "811.1.c",
    "811.1.c.1",
    "811.1.c.2",
    "811.1.c.3",
    "811.1.d",
    "811.1.d.1",
    "811.1.d.1.a",
    "811.1.d.2",
    "811.1.d.3",
    "811.1.d.3.a",
    "811.1.d.4",
    "811.1.d.5",
    "811.2",
    "811.3",
    "811.4",
    "811.5",
    "811.5.a",
    "811.6",
    "811.6.a"
  ],
  expand(): readonly Ability[] {
    return [{
      kind: "static",
      effect: { kind: "cost.hidden" }
    }];
  }
} satisfies KeywordDef;

export default Hidden;

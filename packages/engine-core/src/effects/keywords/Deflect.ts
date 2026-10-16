import type { Ability } from "@riftbound/card-dsl";
import type { KeywordDef } from "../keyword-contract.js";

/**
 * Deflect (Core Rules v1.5, 809) expands to the static target-tax effect.
 *
 * Dependencies not yet merged:
 * - `target.tax` for target legality and per-choice additional costs (RIFT-90).
 * - `cost.pay` for the unrestricted-domain Power payment (RIFT-89).
 *
 * This file only declares the EffectIR expansion. The chain and cost systems
 * remain responsible for applying the tax when an opponent chooses the host.
 */
const Deflect = {
  keyword: "Deflect",
  valued: true,
  stacking: "sum",
  ruleRefs: [
    "809.1",
    "809.1.a",
    "809.1.b",
    "809.1.b.1",
    "809.1.b.2",
    "809.1.b.3",
    "809.1.c",
    "809.1.c.1",
    "809.1.d",
    "809.2",
    "809.3"
  ],
  expand({ value }): readonly Ability[] {
    const deflectValue = value ?? 1;
    return [{
      kind: "static",
      effect: {
        kind: "target.tax",
        value: { kind: "constant", value: deflectValue }
      }
    }];
  }
} satisfies KeywordDef;

export default Deflect;

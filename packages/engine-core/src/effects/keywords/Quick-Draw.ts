/**
 * Quick-Draw expands to the inherent Reaction timing permission and a
 * mandatory play trigger that attaches the source Gear to a friendly Unit.
 *
 * Dependencies that are not merged yet:
 * - `continuous.timing` must grant Reaction timing to both playing and
 *   attaching this Gear.
 * - The play/reaction permission layer must carry the source identity into
 *   the `card-played` event and preserve the trigger's target choice.
 */
import type { Ability, Expr, Value } from "@riftbound/card-dsl";
import type { KeywordDef } from "../keyword-contract.js";

const constant = (value: Value): Expr => ({ kind: "constant", value });

const quickDraw = {
  keyword: "Quick-Draw",
  valued: false,
  stacking: "single",
  ruleRefs: [
    "819",
    "819.1",
    "819.1.a",
    "819.1.b",
    "819.1.c",
    "819.1.d",
    "819.2",
    "819.3"
  ],
  expand({ host }): readonly Ability[] {
    const source = { canonicalCardId: host.canonicalCardId };
    return [
      {
        kind: "static",
        effect: {
          kind: "continuous.timing",
          value: constant("reaction"),
          source,
          scope: "source",
          permissions: ["play", "attach"]
        }
      },
      {
        kind: "triggered",
        trigger: {
          at: "card-played",
          filter: {
            event: "card-played",
            source
          }
        },
        optional: false,
        body: [{
          id: "quick-draw-attach",
          op: "effect.attach",
          args: {
            host: constant({ kind: "target", id: "quick-draw-unit" })
          },
          targets: [{
            id: "quick-draw-unit",
            filter: { type: "unit", controller: "self" },
            min: 1,
            max: 1,
            selection: "one"
          }]
        }]
      }
    ];
  }
} satisfies KeywordDef;

export default quickDraw;

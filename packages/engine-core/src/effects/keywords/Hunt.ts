/**
 * Hunt —— v1.5 规则 823。
 *
 * Hunt is a triggered keyword on units. "When I Conquer or Hold, my
 * controller gains X XP" is represented by two triggered abilities, one for
 * each timing point, with the already-merged `effect.xp` primitive. An omitted
 * value is Hunt 1 (823.1.c.2), and all granted Hunt values are summed into the
 * one value passed to this expansion (823.2), so the keyword declares `sum`
 * stacking.
 *
 * Dependencies not yet merged:
 * - Scoring must emit `conquer` and `hold` into the shared event pipeline, and
 *   the keyword/ability adapter must register these trigger subscriptions.
 * - The trigger/chain path must preserve the source unit and its controller so
 *   the `source: self` event filter and implicit `effect.xp` recipient resolve
 *   against the live host.
 *
 * `effect.xp` is already merged and is used directly; no XP state or scoring
 * flow is implemented in this keyword definition.
 */
import type { Ability, Instruction, TimingPointId } from "@riftbound/card-dsl";

import type { CardContextRef, KeywordDef } from "../keyword-contract.js";

const HUNT_DEFAULT_VALUE = 1;
const HUNT_TIMING_POINTS = ["conquer", "hold"] as const satisfies readonly TimingPointId[];

function expand({ value, host, params }: Parameters<KeywordDef["expand"]>[0]): readonly Ability[] {
  const huntValue = value ?? HUNT_DEFAULT_VALUE;
  const instanceId = typeof params?.instanceId === "string" ? params.instanceId : undefined;
  return HUNT_TIMING_POINTS.map((timingPoint): Ability => {
    const instruction: Instruction = {
      id: instanceId === undefined
        ? `hunt:${host.canonicalCardId}:${timingPoint}:xp`
        : `hunt:${host.canonicalCardId}:${instanceId}:${timingPoint}:xp`,
      op: "effect.xp",
      args: { amount: { kind: "constant", value: huntValue } }
    };
    return {
      kind: "triggered",
      trigger: {
        at: timingPoint,
        filter: { event: timingPoint, filter: { source: "self" } }
      },
      optional: false,
      body: [instruction]
    };
  });
}

const hunt = {
  keyword: "Hunt",
  valued: true,
  stacking: "sum",
  expand,
  ruleRefs: [
    "823",
    "823.1",
    "823.1.a",
    "823.1.b",
    "823.1.c",
    "823.1.c.1",
    "823.1.c.2",
    "823.1.c.3",
    "823.2",
    "823.3"
  ]
} satisfies KeywordDef;

export default hunt;

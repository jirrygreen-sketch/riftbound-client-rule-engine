import type { Ability, Expr, Value } from "@riftbound/card-dsl";

import type { KeywordDef } from "../keyword-contract.js";

/**
 * Deploy — Core Rules v1.5 rule 830.
 *
 * 830.1 makes Deploy both a passive and a triggered keyword on Gear. Its
 * shorthand expands to the location permission that lets the Gear be played or
 * created at any Battlefield, keeps its play/create destination restricted to
 * Battlefields, exempts non-Unit Gear from cleanup recall, and subscribes to
 * an opponent's Hold at the host's Battlefield to kill the host.
 *
 * Dependencies that are not yet merged (RIFT-258/259 and the scoring/trigger
 * integration work):
 * - the `continuous.location` consumer and the Finalize location validator;
 * - cleanup's non-Unit Deploy recall exemption;
 * - the `hold` trigger registration and Battlefield identity carried by the
 *   scoring event.
 * The kill body uses the merged `effect.kill` primitive and is intentionally
 * left executable in isolation. No keyword flow is implemented here.
 */

const constant = (value: Value): Expr => ({ kind: "constant", value });

/**
 * Open ContinuousEffect metadata for the Deploy location/restriction layer.
 * The fields preserve each clause of 830.1.b without choosing a runtime
 * implementation for the not-yet-merged location and cleanup consumers.
 */
const DEPLOY_LOCATION_EFFECT = Object.freeze({
  kind: "continuous.location",
  appliesTo: "self",
  objectType: "gear",
  play: {
    zone: "battlefield",
    anyBattlefield: true,
    includesOccupied: true,
    includesEnemyControlled: true
  },
  create: {
    zone: "battlefield",
    anyBattlefield: true,
    includesOccupied: true,
    includesEnemyControlled: true
  },
  destinationRestriction: { zone: "battlefield" },
  movement: { allowed: true },
  cleanup: { recall: "unit-only" }
} as const);

const deploy = {
  keyword: "Deploy",
  valued: false,
  stacking: "single",
  expand(input: Parameters<KeywordDef["expand"]>[0]): readonly Ability[] {
    void input.value;
    const instanceId = typeof input.params?.instanceId === "string" ? input.params.instanceId : undefined;
    return [
      {
        kind: "static",
        effect: { ...DEPLOY_LOCATION_EFFECT }
      },
      {
        kind: "triggered",
        trigger: {
          at: "hold",
          filter: { event: "hold", here: true, player: "opponent" }
        },
        optional: false,
        body: [{
          id: instanceId === undefined ? "deploy.kill-self" : `deploy.kill-self:${instanceId}`,
          op: "effect.kill",
          args: { self: constant(true) }
        }]
      }
    ];
  },
  ruleRefs: [
    "830",
    "830.1",
    "830.1.a",
    "830.1.b",
    "830.1.b.1",
    "830.1.b.2",
    "830.1.b.3",
    "830.2",
    "830.3"
  ]
} satisfies KeywordDef;

export default deploy;

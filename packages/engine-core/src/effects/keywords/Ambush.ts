import type { Ability, Value } from "@riftbound/card-dsl";

import type { CardContextRef, KeywordDef } from "../keyword-contract.js";

/**
 * Ambush — Core Rules v1.5 §822.
 *
 * 822.1.b gives the Unit two linked permissions: it may be played to a
 * battlefield where its controller controls a Unit, and it has Reaction while
 * being played to that battlefield.  The keyword is therefore expanded into
 * two static declarations.  The declarations are data for the play-location
 * and timing consumers; Ambush does not perform a play or advance the Chain.
 *
 * Dependencies that are not merged yet:
 * - `play-location-permission` / `target.location` still needs the Finalize
 *   location-choice consumer.  That consumer must re-check 822.3 immediately
 *   before finalization, because the friendly Unit may have left the chosen
 *   battlefield.
 * - `continuous.timing` and Chain `canAct` still need to consume the
 *   conditional Reaction permission.  The `location` field below records the
 *   exact 822.1.b scope instead of granting Reaction globally.
 * - The layer-to-keyword registration path and the play-from-hand source
 *   binding are owned by the later continuous-effect/Chain workstreams.
 */

const AMBUSH_BATTLEFIELD: Value = {
  zone: "battlefield",
  // `controller` denotes the keyword host's controller (the player saying
  // "you" in 822.1.b); `self` remains the host object in `appliesTo`.
  battlefield: { occupied: true, controller: "controller" },
  appliesTo: "self"
};

const AMBUSH_LOCATION_PERMISSION = {
  kind: "play-location-permission",
  value: { kind: "constant", value: AMBUSH_BATTLEFIELD },
  duration: "while-in-hand"
} as const;

function expand(input: { readonly value?: number; readonly host: CardContextRef }): readonly Ability[] {
  // Ambush is not a valued keyword.  Keep the host in the signature because
  // KeywordDef expansion is host-bound at registration time; the symbolic
  // `self` selector in the declarations is bound by the runtime later.
  void input.value;
  void input.host;
  return [
    {
      kind: "static",
      effect: { ...AMBUSH_LOCATION_PERMISSION }
    },
    {
      kind: "static",
      effect: {
        kind: "continuous.timing",
        grants: ["showdown", "closed-state"],
        appliesTo: ["card"],
        // Reaction is available only for the Ambush play permission's
        // battlefield scope (822.1.b); this is intentionally declarative.
        location: AMBUSH_BATTLEFIELD
      }
    }
  ];
}

const ambush = {
  keyword: "Ambush",
  valued: false,
  stacking: "single",
  expand,
  ruleRefs: [
    "822",
    "822.1",
    "822.1.a",
    "822.1.b",
    "822.1.c",
    "822.1.d",
    "822.2",
    "822.3",
    "822.3.a",
    "822.4"
  ]
} satisfies KeywordDef;

export default ambush;

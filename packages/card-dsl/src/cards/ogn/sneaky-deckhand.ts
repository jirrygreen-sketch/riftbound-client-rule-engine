import type { CardProgram } from "../../ir/index.js";

/**
 * Sneaky Deckhand (ogn-176-298) — Unit, Chaos (Pirate / Bilgewater).
 *
 * sourceText (packages/card-data/data/deck-catalog.json, ogn-176-298):
 *   You may play me to an open battlefield.
 *
 * Modeling (CR v1.5):
 * - The only ability is an additional valid play location (355.2.b). It is
 *   modeled as the static play-location permission used by the merged sfd
 *   Dauntless Vanguard precedent. The permission shape is present, while the
 *   static binder has no layer mapping for play-location-permission and the
 *   Finalize/placement validator only consumes continuous.location through
 *   playLocations(). "Open" means unoccupied and uncontrolled (170.11.c).
 */
export default {
  canonicalCardId: "card.hash-66b3ff5cc86cf822bdc111bcd4693bcba033d4b02cc95a9e2daf443c8bbedd8a",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「You may play me to an open battlefield」的许可形状已存在，但 programs/statics.ts 的 layerFor 没有" +
    "play-location-permission 映射；Finalize/打出位置校验只通过 layers/rules 的 playLocations() 消费 continuous.location，" +
    "因此该静态许可还不能进入合法位置判断。open = 无单位且未控制（170.11.c；CR 355.2.a/355.2.b）。" +
    "不能近似成默认位置或用其它位置改写。依赖：play-location-permission 的 static layer 映射与 Finalize 位置校验消费。",
  abilities: [
    {
      kind: "static",
      effect: {
        kind: "play-location-permission",
        value: {
          kind: "constant",
          value: {
            zone: "battlefield",
            battlefield: { open: true },
            appliesTo: "self"
          }
        },
        duration: "while-in-hand"
      }
    }
  ],
  sourceText: "You may play me to an open battlefield."
} satisfies CardProgram;

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
 *   Dauntless Vanguard precedent; no engine consumer of that continuous
 *   effect exists yet, so the ability (and therefore the card) remains
 *   judge-required. "Open" means unoccupied and uncontrolled (170.11.c).
 */
export default {
  canonicalCardId: "card.hash-66b3ff5cc86cf822bdc111bcd4693bcba033d4b02cc95a9e2daf443c8bbedd8a",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「You may play me to an open battlefield」需要打出位置许可的消费者：play-location-permission 只有卡数据声明，" +
    "layers/最终化（Make Relevant Choices，CR 355.2.a/355.2.b；open = 无单位且未控制，170.11.c）尚未实现，" +
    "不能近似成默认位置或用其它位置改写。依赖：RIFT-91（layers-continuous）、RIFT-90（打出位置校验）。",
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

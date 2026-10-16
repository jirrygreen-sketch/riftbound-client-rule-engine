import type { CardProgram } from "../../ir/index.js";

/**
 * Sai Scout (ogn-174-298) — Unit, Chaos (Shurima).
 *
 * sourceText (packages/card-data/data/deck-catalog.json, ogn-174-298):
 *   [Vision] (When you play me, look at the top card of your Main Deck. You may
 *   recycle it.)
 *   You may play me to an open battlefield.
 *
 * Modeling (CR v1.5):
 * - [Vision] is declared as a keyword ability only (817); its merged expansion
 *   (effects/keywords/Vision.ts) subscribes at object-enters-board and drives
 *   effect.inspect + effect.recycle, but its non-zero top-of-deck look is
 *   blocked: effect.inspect's own contract requires an upstream ordered
 *   picksSpecId for scope "top" and returns negated/impossible without one,
 *   and no upstream ordered-query wiring is merged (see its header note and
 *   the three failing Vision keyword cases in engine-core).
 * - "You may play me to an open battlefield" grants an additional valid
 *   location during Playing a Card (355.2.a/355.2.b). It is modeled like the
 *   merged sfd Dauntless Vanguard precedent: a static play-location
 *   permission. No consumer of play-location-permission exists in the merged
 *   engine (only the card data declares it), so the permission itself is not
 *   executable and the card stays judge-required. "Open" means unoccupied and
 *   uncontrolled (170.11.c).
 */
export default {
  canonicalCardId: "card.hash-e036ea2d851b80d8cb04068759c6d7e06f97fbc36723f415d5823f097f14cd29",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两块依赖未合入：(1)[Vision]（817.1.b）展开的 Predict 在 effect.inspect 的 scope \"top\" 需要上游按牌库顶提供有序" +
    " picksSpecId，缺失时该原语按契约 negated/impossible 阻断（effect.inspect 头注；engine-core Vision 关键词用例现为 3 个失败），" +
    "有序牌库顶查询契约尚未补齐；(2)「You may play me to an open battlefield」需要打出位置许可的消费者：" +
    "play-location-permission 目前只有卡数据声明，layers/最终化（Make Relevant Choices，CR 355.2.a/355.2.b；" +
    "open = 无单位且未控制，170.11.c）没有实现。依赖：RIFT-64（effect.inspect 有序查询）、RIFT-91（layers-continuous）、" +
    "RIFT-90（打出位置校验）；不近似实现。",
  abilities: [
    { kind: "keyword", keyword: "vision" },
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
  sourceText:
    "[Vision] (When you play me, look at the top card of your Main Deck. You may recycle it.)\n" +
    "You may play me to an open battlefield."
} satisfies CardProgram;

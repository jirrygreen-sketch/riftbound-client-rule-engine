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
 *   (effects/keywords/Vision.ts) subscribes at object-enters-board
 *   and drives effect.inspect + effect.recycle, and the replayed Predict step
 *   executes against a supplied ordered top-of-deck pick (the engine-core
 *   Vision suite is green). What is still missing is the production
 *   assembler: the merged ordered zoneSlice pick source itself (RIFT-66 /
 *   RIFT-358) cannot help this card because the expanded Vision body declares
 *   picksSpecId "vision-top" without declaring a corresponding picks source,
 *   and ctx.picks does not distinguish an unbound pick from an empty one, so
 *   the ordered top-of-deck binding is still a missing assembly-layer gap.
 * - "You may play me to an open battlefield" grants an additional valid
 *   location during Playing a Card (355.2.a/355.2.b). It is modeled like the
 *   merged sfd Dauntless Vanguard precedent: a static play-location
 *   permission. The playLocations query exists, but programs/statics.ts has no
 *   layer mapping for play-location-permission and no Finalize placement
 *   consumer reads the query, so the permission itself is not executable and
 *   the card stays judge-required. "Open" means unoccupied and uncontrolled
 *   (170.11.c).
 */
export default {
  canonicalCardId: "card.hash-e036ea2d851b80d8cb04068759c6d7e06f97fbc36723f415d5823f097f14cd29",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两块依赖未合入：(1)[Vision]（817.1.b）的展开已合入并可执行 Predict——engine-core 的 Vision 用例全过，" +
    "effect.inspect + effect.recycle 在提供有序牌库顶 pick 时真实执行；但生产打出仍缺「按牌库顶顺序取 1 张」的装配层供给：" +
    "Vision 展开 body 只声明 picksSpecId \"vision-top\" 而没有声明对应 picks 来源，已合入的有序 zoneSlice pick 来源" +
    "（RIFT-66 契约变更随 RIFT-358 落地）帮不到它，且 ctx.picks 不区分未绑定与空集合，" +
    "生产侧的真实牌库顶绑定与控制者注入仍是装配层缺口；(2)「You may play me to an open battlefield」需要打出位置许可的消费者：" +
    "continuous.location 原语与 layers/rules 的 playLocations 查询已合入，但 programs/statics.ts 的 layerFor() 没有 play-location-permission 映射，" +
    "也没有最终化侧（Make Relevant Choices，CR 355.2.a/355.2.b；open = 无单位且未控制，170.11.c）的放置消费方。不近似实现。",
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
